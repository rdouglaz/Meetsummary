/**
 * Browser-side upload pipeline: file → transcript → summary → Supabase.
 *
 * Stages:
 *   extracting   (0–24 %)  – AudioContext decode + resample to 16 kHz mono PCM
 *   transcribing (25–64 %) – Deepgram REST Nova-3 with diarization
 *   summarizing  (65–84 %) – OpenRouter structured JSON summary
 *   saving       (85–95 %) – Upload audio to Storage + Supabase bulk insert
 *   complete     (100 %)
 */

import { extractAndResampleAudio }   from './audio-processor';
import { transcribeWithDeepgram }     from './deepgram-rest';
import { getSetting }                 from './exports';
import { callOpenRouter }             from './openrouter';
import { savePipelineResult }         from '../services/meetings';
import { getR2UploadUrl }             from './r2-client';
import type { DGUtterance }           from './deepgram-rest';
import type { Database }              from './database.types';

type MeetingSource = Database['public']['Tables']['meetings']['Row']['source'];

// ─── Public types ─────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'extracting'
  | 'transcribing'
  | 'summarizing'
  | 'saving'
  | 'complete'
  | 'error';

export interface PipelineUpdate {
  stage:          PipelineStage;
  pct:            number;          // 0-100 overall progress
  detail?:        string;          // human-readable step label
  error?:         string;          // set when stage === 'error'
  meetingId?:     string;          // set when stage === 'complete'
  storageWarning?: string;         // non-fatal storage issue
  stats?: {
    duration:      number;
    speakerCount:  number;
    originalSize:  number;
    processedSize: number;
    compressionPct: number;
  };
}

export interface PipelineOptions {
  source:       MeetingSource;
  mode:         'short' | 'client';
  title:        string;
  agendaItems?: string[];
}

// ─── WAV builder ─────────────────────────────────────────────────────────────

function buildWavBlob(pcmBuffer: ArrayBuffer, sampleRate: number): Blob {
  const dataSize  = pcmBuffer.byteLength;
  const header    = new ArrayBuffer(44);
  const view      = new DataView(header);
  const writeStr  = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4,  36 + dataSize,      true); // file size - 8
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16,                 true); // PCM chunk size
  view.setUint16(20, 1,                  true); // PCM format
  view.setUint16(22, 1,                  true); // mono
  view.setUint32(24, sampleRate,         true);
  view.setUint32(28, sampleRate * 2,     true); // byte rate (16-bit mono)
  view.setUint16(32, 2,                  true); // block align
  view.setUint16(34, 16,                 true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize,           true);
  return new Blob([header, pcmBuffer], { type: 'audio/wav' });
}

// ─── OpenRouter summarization ─────────────────────────────────────────────────

interface SummaryJSON {
  overview: {
    date:         string;
    duration:     string;
    participants: string[];
    mainPurpose:  string;
  };
  keyDiscussionPoints: string[];
  keyDecisions:        string[];
  actionItems: { task: string; owner: string | null; dueDate: string | null }[];
  followUpEmail: string;
  risks: string[];
}

async function generateSummary(
  utterances:   DGUtterance[],
  duration:     number,
  title:        string,
  mode:         'short' | 'client',
  apiKey:       string,
  agendaItems?: string[],
): Promise<SummaryJSON | null> {
  if (!apiKey) return null;

  const speakerLabel = (n: number) => `Speaker ${n + 1}`;
  let transcript = utterances
    .map(u => `${speakerLabel(u.speaker)}: ${u.transcript}`)
    .join('\n');
  if (transcript.length > 8000) transcript = transcript.slice(0, 8000) + '\n[… truncated …]';

  const mins     = Math.round(duration / 60);
  const modeNote = mode === 'client'
    ? 'Use a polished, professional tone suitable to share directly with the client.'
    : 'Be concise — keep the summary under 300 words and focus on action items.';

  const agendaNote = agendaItems?.length
    ? `\nAgenda (structure your key discussion points around these topics in order):\n${agendaItems.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
    : '';

  const systemPrompt = [
    'You are a professional meeting analyst.',
    modeNote,
    `Meeting title: "${title}". Duration: ~${mins} minutes.${agendaNote}`,
    'Respond with ONLY valid JSON — no markdown, no explanation, no code fences.',
    'Schema:',
    JSON.stringify({
      overview: { date: 'ISO date (today if unknown)', duration: `~${mins} minutes`, participants: ['Speaker 1'], mainPurpose: 'one sentence' },
      keyDiscussionPoints: ['string'],
      keyDecisions:        ['string'],
      actionItems: [{ task: 'string', owner: 'string or null', dueDate: 'YYYY-MM-DD or null' }],
      followUpEmail: 'full email text with Subject line',
      risks: ['string'],
    }),
  ].join('\n');

  try {
    const content = await callOpenRouter(
      apiKey,
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript }],
      'upload-summary',
    );
    // Strip markdown code fences if model wraps output despite instructions
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    return JSON.parse(cleaned) as SummaryJSON;
  } catch {
    return null; // summarization failure is non-fatal; transcript is already saved
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runUploadPipeline(
  file:     File,
  opts:     PipelineOptions,
  onUpdate: (u: PipelineUpdate) => void,
): Promise<void> {
  const dgKey = getSetting('DEEPGRAM_API_KEY');
  if (!dgKey) {
    onUpdate({ stage: 'error', pct: 0, error: 'Deepgram API key not configured. Go to Settings → AI Services to add your key.' });
    (window as any).pendo?.track('meeting_upload_failed', {
      failedStage: 'extracting', errorMessage: 'Deepgram API key not configured',
      source: opts.source, outputMode: opts.mode, fileSizeMB: parseFloat((file.size / (1024 * 1024)).toFixed(2)),
    });
    return;
  }

  // ── Stage 1: Extract & resample audio (0–24%) ──────────────────────────────
  onUpdate({ stage: 'extracting', pct: 0, detail: 'Reading file…' });

  let audioResult: Awaited<ReturnType<typeof extractAndResampleAudio>>;
  try {
    audioResult = await extractAndResampleAudio(file, pct => {
      onUpdate({
        stage:  'extracting',
        pct:    Math.round(pct * 0.24),
        detail: pct < 20 ? 'Reading file…' : pct < 50 ? 'Decoding audio…' : 'Resampling to 16 kHz…',
      });
    });
  } catch (err) {
    onUpdate({ stage: 'error', pct: 0, error: err instanceof Error ? err.message : 'Audio extraction failed' });
    (window as any).pendo?.track('meeting_upload_failed', {
      failedStage: 'extracting', errorMessage: (err instanceof Error ? err.message : 'Audio extraction failed').slice(0, 100),
      source: opts.source, outputMode: opts.mode, fileSizeMB: parseFloat((file.size / (1024 * 1024)).toFixed(2)),
    });
    return;
  }

  // ── Stage 2: Transcribe with Deepgram REST (25–64%) ───────────────────────
  onUpdate({ stage: 'transcribing', pct: 25, detail: 'Sending to Deepgram Nova-3…' });

  let dgResult: Awaited<ReturnType<typeof transcribeWithDeepgram>>;
  try {
    dgResult = await transcribeWithDeepgram(audioResult.pcm, dgKey, pct => {
      onUpdate({
        stage:  'transcribing',
        pct:    25 + Math.round(pct * 0.40),
        detail: pct < 50 ? 'Uploading compressed audio…' : 'Receiving transcript…',
      });
    });
  } catch (err) {
    onUpdate({ stage: 'error', pct: 25, error: err instanceof Error ? err.message : 'Transcription failed' });
    (window as any).pendo?.track('meeting_upload_failed', {
      failedStage: 'transcribing', errorMessage: (err instanceof Error ? err.message : 'Transcription failed').slice(0, 100),
      source: opts.source, outputMode: opts.mode, fileSizeMB: parseFloat((file.size / (1024 * 1024)).toFixed(2)),
    });
    return;
  }

  // ── Stage 3: Summarize with OpenRouter (65–84%) ───────────────────────────
  const orKey = getSetting('OPENROUTER_API_KEY');
  onUpdate({ stage: 'summarizing', pct: 65, detail: 'Generating AI summary…' });

  const summary = await generateSummary(
    dgResult.utterances,
    dgResult.duration || audioResult.duration,
    opts.title,
    opts.mode,
    orKey,
    opts.agendaItems,
  );

  // ── Stage 4a: Compress + upload WAV to Cloudflare R2 (85–90%) ───────────────
  // Builds a 16 kHz mono WAV from the PCM buffer (already extracted for Deepgram).
  // Uploading this compressed representation reduces storage vs the original file
  // (e.g. stereo 44.1 kHz MP4 → mono 16 kHz WAV cuts size by ~80–90 %).
  // A presigned PUT URL is obtained from the r2-presign Edge Function so that
  // no R2 credentials ever touch the browser.
  onUpdate({ stage: 'saving', pct: 85, detail: 'Uploading audio to R2…' });

  let fileUrl:        string | null = null; // stores the R2 object key, not a public URL
  let storageWarning: string | undefined;
  try {
    const wavBlob              = buildWavBlob(audioResult.pcm, 16000);
    const { uploadUrl, key }   = await getR2UploadUrl('audio/wav');

    const uploadRes = await fetch(uploadUrl, {
      method:  'PUT',
      body:    wavBlob,
      headers: { 'Content-Type': 'audio/wav' },
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      const lower   = errText.toLowerCase();
      if (uploadRes.status === 413 || lower.includes('too large') || lower.includes('exceeded')) {
        storageWarning = 'Recording too long for cloud storage — transcript saved, karaoke playback unavailable.';
      } else {
        storageWarning = `Audio upload failed (${uploadRes.status}) — transcript saved, karaoke unavailable.`;
      }
    } else {
      fileUrl = key; // store the R2 key; signed URLs are generated on-demand
    }
  } catch (err) {
    storageWarning = 'Audio upload failed — transcript saved, karaoke playback unavailable.';
    console.warn('R2 upload failed:', err instanceof Error ? err.message : err);
  }

  // ── Stage 4b: Save text outputs to Supabase (90–95%) ─────────────────────
  onUpdate({ stage: 'saving', pct: 90, detail: 'Saving to library…' });

  let meetingId: string;
  try {
    meetingId = await savePipelineResult({
      title:       opts.title,
      fileName:    file.name,
      fileSize:    file.size,
      fileUrl,
      source:      opts.source,
      duration:    dgResult.duration || audioResult.duration,
      mode:        opts.mode,
      utterances:  dgResult.utterances,
      summary,
      agendaItems: opts.agendaItems,
    });
  } catch (err) {
    onUpdate({ stage: 'error', pct: 90, error: `Failed to save results: ${err instanceof Error ? err.message : String(err)}` });
    (window as any).pendo?.track('meeting_upload_failed', {
      failedStage: 'saving', errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 100),
      source: opts.source, outputMode: opts.mode, fileSizeMB: parseFloat((file.size / (1024 * 1024)).toFixed(2)),
    });
    return;
  }

  // ── Stage 5: Complete ──────────────────────────────────────────────────────
  const completionStats = {
    duration:       Math.round(dgResult.duration || audioResult.duration),
    speakerCount:   dgResult.speakerCount,
    originalSize:   audioResult.originalSize,
    processedSize:  audioResult.processedSize,
    compressionPct: Math.round((1 - audioResult.processedSize / audioResult.originalSize) * 100),
  };

  onUpdate({
    stage:          'complete',
    pct:            100,
    meetingId,
    storageWarning,
    stats: completionStats,
  });

  // Pendo Track: meeting upload completed successfully
  (window as any).pendo?.track('meeting_upload_completed', {
    source:          opts.source,
    outputMode:      opts.mode,
    fileSizeMB:      parseFloat((file.size / (1024 * 1024)).toFixed(2)),
    durationSeconds: completionStats.duration,
    speakerCount:    completionStats.speakerCount,
    compressionPct:  completionStats.compressionPct,
    hasAgenda:       (opts.agendaItems?.length ?? 0) > 0,
    agendaItemCount: opts.agendaItems?.length ?? 0,
  });
}

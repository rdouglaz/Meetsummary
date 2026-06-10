/**
 * Deepgram pre-recorded (REST) API client.
 * Used for uploaded audio/video files — NOT for live microphone streaming
 * (live uses deepgram-ws.ts with the WebSocket API).
 *
 * Sends raw Int16 PCM at 16 kHz mono to POST /v1/listen.
 * Returns speaker-diarized utterances and word-level timestamps.
 */

const DG_REST_BASE   = 'https://api.deepgram.com/v1/listen';
// Send WAV (not raw PCM) — standard MIME avoids HTTP/2 protocol errors on large bodies.
// diarize_model=latest selects the v2 batch diarizer (more accurate than legacy diarize=true).
// encoding/sample_rate/channels are omitted because the WAV header carries them.
const DG_REST_PARAMS = new URLSearchParams({
  model:            'nova-3',
  diarize_model:    'latest',
  smart_format:     'true',
  punctuate:        'true',
  utterances:       'true',
  words:            'true',
});
const DG_REST_URL = `${DG_REST_BASE}?${DG_REST_PARAMS}`;

// Build a 16-bit mono WAV blob from raw Int16 PCM at the given sample rate.
function pcmToWav(pcm: ArrayBuffer, sampleRate: number): Blob {
  const dataSize = pcm.byteLength;
  const header   = new ArrayBuffer(44);
  const v        = new DataView(header);
  const s        = (o: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  s(0,  'RIFF'); v.setUint32(4,  36 + dataSize, true);
  s(8,  'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1,             true); // PCM
  v.setUint16(22, 1,             true); // mono
  v.setUint32(24, sampleRate,    true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2,             true); // block align
  v.setUint16(34, 16,            true); // bits per sample
  s(36, 'data'); v.setUint32(40, dataSize, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

export interface DGWord {
  word:             string;
  punctuated_word?: string;
  start:            number;
  end:              number;
  confidence:       number;
  speaker?:         number;
}

export interface DGUtterance {
  id:         string;
  speaker:    number;
  start:      number;
  end:        number;
  confidence: number;
  transcript: string;
  words:      DGWord[];
}

export interface DGRestResult {
  transcript: string;
  utterances: DGUtterance[];
  words:      DGWord[];
  duration:   number;   // seconds
  speakerCount: number; // distinct speaker numbers observed
}

export async function transcribeWithDeepgram(
  pcm:        ArrayBuffer,
  apiKey:     string,
  onProgress?: (pct: number) => void,
): Promise<DGRestResult> {
  if (!apiKey) {
    throw new Error(
      'Deepgram API key not configured. Go to Settings → AI Services to add your key.',
    );
  }

  onProgress?.(5);

  const wavBlob = pcmToWav(pcm, 16000);

  const MAX_RETRIES = 2;
  let res!: Response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(DG_REST_URL, {
      method:  'POST',
      headers: {
        Authorization:  `Token ${apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: wavBlob,
    });
    if (res.status !== 408 || attempt === MAX_RETRIES) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  onProgress?.(85);

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.err_msg ?? body?.message ?? detail;
    } catch { /* ignore json parse error */ }
    throw new Error(`Deepgram transcription failed: ${detail}`);
  }

  const data = await res.json();
  onProgress?.(100);

  const channel     = data?.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  if (!alternative) {
    throw new Error('Deepgram returned no transcription result. The audio may be silent or too short.');
  }

  const utterances: DGUtterance[] = data?.results?.utterances ?? [];
  const speakerNums = new Set(utterances.map((u: DGUtterance) => u.speaker));

  return {
    transcript:   alternative.transcript ?? '',
    utterances,
    words:        alternative.words ?? [],
    duration:     data?.metadata?.duration ?? 0,
    speakerCount: speakerNums.size || 1,
  };
}

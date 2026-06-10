import { useState, useEffect, useRef, useCallback } from 'react';
import { Pause, Play, Square, Star, Wifi, WifiOff, ChevronLeft, Loader2, Copy, Check, Download, Mail, ArrowRight, MessageSquare, Brain, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { LiveWaveform } from './live-waveform';
import { LiveTranscriptPanel } from './live-transcript-panel';
import { LiveCopilotPanel } from './live-copilot-panel';
import { LiveSessionSetup } from './live-session-setup';
import { LivePhase, LiveUtterance, AIEvent, LiveSummaryState, ChatMessage, CoachingPrompt, LiveSettings } from '../live-types';
import { analyzeSentiment } from '../../lib/sentiment';
import type { Sentiment } from '../../lib/sentiment';
import {
  createLiveSession,
  endLiveSession,
  abortLiveSession,
  pauseLiveSession,
  resumeLiveSession,
  saveTranscriptChunk,
  saveAIEvent,
  upsertRunningSummary,
  subscribeToTranscript,
  subscribeToAIEvents,
} from '../../services/live-session';
import { DeepgramStreamClient } from '../../lib/deepgram-ws';
import type { Database } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';
import { getR2UploadUrl } from '../../lib/r2-client';
import { getSetting } from '../../lib/exports';
import { callOpenRouter } from '../../lib/openrouter';
import { NavPage } from '../types';

type ChunkRow = Database['public']['Tables']['transcript_chunks']['Row'];
type AIEventRow = Database['public']['Tables']['ai_events']['Row'];

function formatTimer(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

const SPEAKER_COLOR_MAP = ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4', 'Speaker 5'];

function dominantSpeaker(words: { speaker?: number }[]): number {
  const counts: Record<number, number> = {};
  for (const w of words) {
    if (w.speaker !== undefined) counts[w.speaker] = (counts[w.speaker] ?? 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return 0;
  return Number(entries.sort((a, b) => Number(b[1]) - Number(a[1]))[0][0]);
}

function rowToUIUtterance(chunk: ChunkRow): LiveUtterance {
  return {
    id: chunk.id,
    speaker: chunk.speaker ?? 'Speaker 1',
    text: chunk.text,
    startTime: chunk.timestamp_start ?? 0,
    endTime: chunk.timestamp_end ?? undefined,
    isFinal: chunk.is_final,
  };
}

function rowToUIEvent(ev: AIEventRow): AIEvent {
  return {
    id: ev.id,
    type: ev.type,
    content: ev.content,
    owner: ev.owner ?? undefined,
    dueDate: ev.due_date ?? undefined,
    confidence: ev.confidence ?? 0.9,
    timestamp: 0,
    approved: ev.approved ?? undefined,
  };
}

interface LiveMeetingPageProps {
  onNavigate: (page: NavPage) => void;
}

export function LiveMeetingPage({ onNavigate }: LiveMeetingPageProps) {
  const [phase, setPhase] = useState<LivePhase>('setup');
  const [elapsed, setElapsed] = useState(0);
  const [utterances, setUtterances] = useState<LiveUtterance[]>([]);
  const [streamingWords, setStreamingWords] = useState<string[]>([]);
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  const [activeSpeaker, setActiveSpeaker] = useState('');
  const [aiEvents, setAiEvents] = useState<AIEvent[]>([]);
  const [summary, setSummary] = useState<LiveSummaryState>({
    running: '', decisions: [], actionItems: [], risks: [], questions: [], commitments: [], importantMoments: [], lastUpdated: 0,
  });
  const [isSummaryUpdating, setIsSummaryUpdating] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const [wsError, setWsError] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [markedMoments, setMarkedMoments] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'transcript' | 'copilot'>('transcript');
  const [startError, setStartError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [coachingPrompts, setCoachingPrompts] = useState<CoachingPrompt[]>([]);
  const [utteranceSentiments, setUtteranceSentiments] = useState<Sentiment[]>([]);
  const [agendaItems, setAgendaItems] = useState<string[]>([]);

  const timerRef = useRef<number | null>(null);
  const dgClientRef = useRef<DeepgramStreamClient | null>(null);
  const summaryTimerRef = useRef<number | null>(null);
  const transcriptBufferRef = useRef<string>('');
  const previousSummaryRef = useRef<string>('');
  const earlyTriggerFiredRef = useRef(false);
  // Maps Deepgram's raw speaker IDs to stable session-scoped labels.
  // Deepgram v1 streaming sometimes re-IDs an existing speaker mid-session
  // (e.g. after a pause or mic movement), creating a phantom 3rd speaker.
  // When a new ID appears and ≥2 speakers are already known, we remap it to
  // whichever known speaker spoke most recently (within a 10 s window) rather
  // than minting a new label.
  const speakerNormRef = useRef<Map<number, { label: string; lastTs: number }>>(new Map());
  const realtimeChannelsRef = useRef<ReturnType<typeof supabase.channel>[]>([]);
  const targetLanguageRef = useRef<string>(getSetting('TRANSLATION_LANGUAGE') || 'none');
  const phaseRef = useRef<LivePhase>('setup');
  const sessionIdRef = useRef<string | null>(null);
  const meetingIdRef = useRef<string | null>(null);

  const handleIncomingChunk = useCallback((chunk: ChunkRow) => {
    if (!chunk.is_final) return;
    const sentiment = analyzeSentiment(chunk.text);
    const utterance = { ...rowToUIUtterance(chunk), sentiment };
    setUtterances(prev => [...prev, utterance]);
    setUtteranceSentiments(prev => [...prev, sentiment]);
    transcriptBufferRef.current += `\n${chunk.speaker ?? 'Unknown'}: ${chunk.text}`;
    setActiveSpeaker(chunk.speaker ?? '');

    // Live translation (non-blocking)
    const targetLang = targetLanguageRef.current;
    if (targetLang && targetLang !== 'none') {
      const apiKey = getSetting('OPENROUTER_API_KEY');
      if (apiKey) {
        callOpenRouter(
          apiKey,
          [
            { role: 'system', content: `Translate the following text to ${targetLang}. Return only the translation, nothing else.` },
            { role: 'user', content: chunk.text },
          ],
          'live-translate',
        ).then(translation => {
          if (translation) {
            setUtterances(prev => prev.map(u => u.id === chunk.id ? { ...u, translation } : u));
          }
        }).catch(() => {});
      }
    }
  }, []);

  const handleIncomingAIEvent = useCallback((ev: AIEventRow) => {
    setAiEvents(prev => {
      if (prev.find(e => e.id === ev.id)) return prev;
      return [...prev, rowToUIEvent(ev)];
    });
    if (ev.type === 'decision') setSummary(prev => ({ ...prev, decisions: [...prev.decisions, ev.content] }));
    if (ev.type === 'risk') setSummary(prev => ({ ...prev, risks: [...prev.risks, ev.content] }));
  }, []);

  const setupRealtimeSubscriptions = useCallback((sid: string) => {
    const ch1 = subscribeToTranscript(sid, handleIncomingChunk);
    const ch2 = subscribeToAIEvents(sid, handleIncomingAIEvent);
    realtimeChannelsRef.current = [ch1, ch2];
  }, [handleIncomingChunk, handleIncomingAIEvent]);

  // Generates a structured JSON summary at end-of-meeting and saves all fields
  // so that meeting-detail's AISummaryPanel can display them properly.
  const generateFinalSummary = useCallback(async (mId: string, liveUtterances: LiveUtterance[]) => {
    const apiKey = getSetting('OPENROUTER_API_KEY');
    const finalUtterances = liveUtterances.filter(u => u.isFinal);
    if (!apiKey || finalUtterances.length === 0) return;

    const transcript = finalUtterances.map(u => `${u.speaker}: ${u.text}`).join('\n');
    if (!transcript.trim()) return;

    const durationSecs = finalUtterances[finalUtterances.length - 1]?.endTime ?? 0;
    const minutes = Math.max(1, Math.round(durationSecs / 60));

    const systemPrompt = [
      'You are a professional meeting analyst. Be concise — keep the summary under 300 words.',
      `Duration: ~${minutes} minutes. Today\'s date: ${new Date().toISOString().slice(0, 10)}.`,
      'Respond with ONLY valid JSON — no markdown, no explanation, no code fences.',
      'Schema:',
      JSON.stringify({
        overview: { date: 'ISO date', duration: `~${minutes} minutes`, participants: ['Speaker 1'], mainPurpose: 'one sentence' },
        keyDiscussionPoints: ['string'],
        keyDecisions:        ['string'],
        actionItems: [{ task: 'string', owner: 'string or null', dueDate: 'YYYY-MM-DD or null' }],
        followUpEmail: 'full email with Subject line',
        risks: ['string'],
      }),
    ].join('\n');

    try {
      const raw = await callOpenRouter(
        apiKey,
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript.slice(0, 8000) }],
        'live-summary',
      );
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned) as {
        overview: { date: string; duration: string; participants: string[]; mainPurpose: string };
        keyDiscussionPoints: string[];
        keyDecisions: string[];
        actionItems: { task: string; owner: string | null; dueDate: string | null }[];
        followUpEmail: string;
        risks: string[];
      };

      const { data: existing } = await supabase.from('summaries').select('id').eq('meeting_id', mId).maybeSingle();
      const summaryPayload = {
        overview:              parsed.overview,
        key_discussion_points: parsed.keyDiscussionPoints ?? [],
        key_decisions:         parsed.keyDecisions ?? [],
        follow_up_email:       parsed.followUpEmail ?? '',
        risks:                 parsed.risks ?? [],
        mode:                  'short' as const,
      };
      if (existing) {
        await supabase.from('summaries').update(summaryPayload).eq('id', existing.id);
      } else {
        await supabase.from('summaries').insert({ meeting_id: mId, ...summaryPayload });
      }

      if (parsed.actionItems?.length > 0) {
        await supabase.from('action_items').insert(
          parsed.actionItems.map(ai => ({ meeting_id: mId, task: ai.task, owner: ai.owner, due_date: ai.dueDate, status: 'pending' as const })),
        );
      }

      // Pendo Track: AI summary generated
      (window as any).pendo?.track('ai_summary_generated', {
        meetingId: mId,
        actionItemsExtracted: parsed.actionItems?.length ?? 0,
        keyDecisionsCount: parsed.keyDecisions?.length ?? 0,
        risksCount: parsed.risks?.length ?? 0,
        hasFollowUpEmail: !!parsed.followUpEmail,
        summaryMode: 'short',
      });
    } catch {
      // Non-fatal — transcript already saved
    }
  }, []);

  const triggerLLMSummary = useCallback(async (mId: string) => {
    const latestChunk = transcriptBufferRef.current.slice(-3000);
    if (!latestChunk.trim()) return;
    const apiKey = getSetting('OPENROUTER_API_KEY');
    if (!apiKey) {
      setSummary(prev => ({ ...prev, running: '⚠️ AI summary requires an OpenRouter API key. Add one in Settings → AI Services.' }));
      return;
    }
    setIsSummaryUpdating(true);
    try {
      const systemPrompt = previousSummaryRef.current
        ? `You are a meeting assistant. Update the running summary with the new transcript. Previous summary: ${previousSummaryRef.current}`
        : 'You are a meeting assistant. Summarize this meeting transcript segment concisely, focusing on key points, decisions, and action items.';
      const runningSummary = await callOpenRouter(
        apiKey,
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: latestChunk }],
        'live-summary',
      );
      if (runningSummary) {
        previousSummaryRef.current = runningSummary;
        setSummary(prev => ({ ...prev, running: runningSummary, lastUpdated: Date.now() }));
        await upsertRunningSummary(mId, runningSummary);
        transcriptBufferRef.current = '';

        // Generate coaching prompts in parallel (non-blocking)
        callOpenRouter(
          apiKey,
          [
            {
              role: 'system',
              content: 'You are a meeting coach. Based on the meeting transcript, generate 3 concise coaching tips for the facilitator. ' +
                'Return a JSON array with objects: [{"type": "tip"|"caution"|"question", "content": "..."}]. Return only valid JSON, no explanation.',
            },
            { role: 'user', content: latestChunk },
          ],
          'live-coaching',
        ).then(raw => {
          try {
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return;
            const parsed = JSON.parse(jsonMatch[0]) as { type: string; content: string }[];
            if (!Array.isArray(parsed)) return;
            const prompts: CoachingPrompt[] = parsed
              .filter(p => p.type && p.content)
              .map(p => ({
                id: crypto.randomUUID(),
                type: (['tip', 'caution', 'question'].includes(p.type) ? p.type : 'tip') as CoachingPrompt['type'],
                content: p.content,
                timestamp: Date.now(),
              }));
            if (prompts.length > 0) {
              setCoachingPrompts(prev => [...prompts, ...prev].slice(0, 20));
            }
          } catch { /* malformed JSON — silently skip */ }
        }).catch(() => {});
      }
    } catch {
      // live summary failure is non-fatal — silently logged by callOpenRouter
    } finally {
      setIsSummaryUpdating(false);
    }
  }, []);

  const startMeeting = useCallback(async (source: LiveSettings['source'], liveSettings: LiveSettings) => {
    setStartError(null);
    setPhase('connecting');
    setAgendaItems(liveSettings.agendaItems ?? []);
    speakerNormRef.current.clear();

    // Mic access (required for browser source)
    let stream: MediaStream | null = null;
    if (source === 'browser') {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setMicStream(stream);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setStartError(`Microphone access denied: ${msg}. Allow microphone access in your browser and try again.`);
        setPhase('setup');
        return;
      }
    }

    // Create session in database
    let sessionData: Awaited<ReturnType<typeof createLiveSession>>;
    try {
      sessionData = await createLiveSession(source, liveSettings as unknown as Record<string, unknown>, liveSettings.agendaItems);
    } catch (err) {
      stream?.getTracks().forEach(t => t.stop());
      const msg = err instanceof Error ? err.message : String(err);
      setStartError(`Failed to create session: ${msg}`);
      setPhase('setup');
      return;
    }

    const { session, meeting } = sessionData;
    setSessionId(session.id);
    setMeetingId(meeting.id);
    setupRealtimeSubscriptions(session.id);

    // Pendo Track: live session started
    (window as any).pendo?.track('live_session_started', {
      source,
      diarization: liveSettings.diarization ?? true,
      smartFormat: liveSettings.smartFormat ?? true,
      interimResults: liveSettings.interimResults ?? true,
      language: liveSettings.language ?? 'auto',
      outputMode: liveSettings.outputMode ?? 'short',
      hasAgenda: (liveSettings.agendaItems?.length ?? 0) > 0,
      agendaItemCount: liveSettings.agendaItems?.length ?? 0,
    });

    // Start Deepgram WebSocket if we have a mic stream
    if (stream) {
      const dgApiKey = getSetting('DEEPGRAM_API_KEY');
      if (!dgApiKey) {
        stream.getTracks().forEach(t => t.stop());
        setStartError('Deepgram API key not configured. Go to Settings → AI Services to add your key.');
        setPhase('setup');
        return;
      }
      const dgClient = new DeepgramStreamClient({
        apiKey: dgApiKey,
        onOpen: () => { setWsStatus('connected'); setWsError(null); },
        onClose: () => {
          setWsStatus('disconnected');
          setWsError('Transcription disconnected. Click End Meeting to save what was captured.');
        },
        onError: () => {
          setWsStatus('disconnected');
          setWsError('Transcription error. Check your Deepgram API key in Settings → AI Services.');
        },
        onTranscript: async (result, el) => {
          const alt = result.channel.alternatives[0];
          if (!alt?.transcript) return;
          const dgSpeaker = dominantSpeaker(alt.words ?? []);
          const utteranceEndTs = alt.words?.[alt.words.length - 1]?.end ?? el;

          // Normalise Deepgram speaker ID → stable session label
          const norm = speakerNormRef.current;
          let speakerLabel: string;
          const existing = norm.get(dgSpeaker);
          if (existing) {
            existing.lastTs = utteranceEndTs;
            speakerLabel = existing.label;
          } else {
            const known = [...norm.values()];
            // If ≥2 speakers are already established and the new ID appears within
            // 10 s of a known speaker, treat it as a Deepgram re-ID, not a new person.
            const REMAP_WINDOW_S = 10;
            const recent = known
              .filter(s => utteranceEndTs - s.lastTs < REMAP_WINDOW_S)
              .sort((a, b) => b.lastTs - a.lastTs)[0];
            if (known.length >= 2 && recent) {
              norm.set(dgSpeaker, { label: recent.label, lastTs: utteranceEndTs });
              speakerLabel = recent.label;
            } else {
              // Genuinely new speaker
              const label = SPEAKER_COLOR_MAP[known.length] ?? `Speaker ${known.length + 1}`;
              norm.set(dgSpeaker, { label, lastTs: utteranceEndTs });
              speakerLabel = label;
            }
          }
          setStreamingSpeaker(speakerLabel);
          setStreamingWords(alt.transcript.split(' '));
          if (result.is_final && alt.transcript.trim()) {
            setActiveSpeaker(speakerLabel);
            await saveTranscriptChunk({ session_id: session.id, meeting_id: meeting.id, speaker: speakerLabel, text: alt.transcript, timestamp_start: alt.words?.[0]?.start ?? el, timestamp_end: alt.words?.[alt.words.length - 1]?.end ?? el, is_final: true, words: alt.words ?? null });
            setStreamingWords([]);
            setStreamingSpeaker('');
          }
        },
        onUtterance: () => {},
      });
      dgClientRef.current = dgClient;
      await dgClient.start(stream);
    }

    setPhase('live');
    summaryTimerRef.current = window.setInterval(() => triggerLLMSummary(meeting.id), 300000);
  }, [setupRealtimeSubscriptions, triggerLLMSummary]);

  // Keep refs in sync so the unmount cleanup always has current values
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { meetingIdRef.current = meetingId; }, [meetingId]);

  // Early summary: fire once after ~500 chars of transcript (~2 min speech),
  // well before the 5-minute periodic timer so users see output sooner.
  useEffect(() => {
    if (phase !== 'live') return;
    if (earlyTriggerFiredRef.current) return;
    if (transcriptBufferRef.current.length >= 500 && meetingId) {
      earlyTriggerFiredRef.current = true;
      triggerLLMSummary(meetingId);
    }
  }, [utterances, phase, meetingId, triggerLLMSummary]);

  // Safety net: if the component unmounts while a session is still active
  // (browser back, tab close, navigation away), mark the meeting as error
  useEffect(() => {
    return () => {
      const p = phaseRef.current;
      const sid = sessionIdRef.current;
      const mid = meetingIdRef.current;
      if ((p === 'live' || p === 'paused') && sid && mid) {
        abortLiveSession(sid, mid).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (phase === 'live') {
      timerRef.current = window.setInterval(() => setElapsed(p => p + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  const pauseResume = async () => {
    if (phase === 'live') {
      dgClientRef.current?.pause();
      if (sessionId) await pauseLiveSession(sessionId);
      setPhase('paused');
      // Pendo Track: live session paused
      (window as any).pendo?.track('live_session_paused', {
        elapsedSeconds: elapsed,
        utteranceCount: utterances.length,
        meetingId: meetingId ?? undefined,
      });
      if (meetingId) triggerLLMSummary(meetingId);
    } else if (phase === 'paused') {
      dgClientRef.current?.resume();
      if (sessionId) await resumeLiveSession(sessionId);
      setPhase('live');
    }
  };

  const markImportant = () => {
    setMarkedMoments(prev => [...prev, elapsed]);
    if (meetingId && sessionId) {
      saveAIEvent({ type: 'important', content: `Key moment manually marked at ${formatTimer(elapsed)}`, meeting_id: meetingId, session_id: sessionId, confidence: 1 });
    }
    // Pendo Track: important moment marked
    (window as any).pendo?.track('important_moment_marked', {
      meetingId: meetingId ?? undefined,
      sessionId: sessionId ?? undefined,
      elapsedSeconds: elapsed,
    });
  };

  const endMeeting = async () => {
    // Capture audio blob before stop() clears the stream
    const audioBlob = dgClientRef.current?.getAudioBlob() ?? null;

    dgClientRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    if (summaryTimerRef.current) clearInterval(summaryTimerRef.current);
    realtimeChannelsRef.current.forEach(c => supabase.removeChannel(c));

    setPhase('ending');

    let updateSuccess = false;
    if (sessionId && meetingId) {
      try {
        // Upload audio to R2 in parallel with LLM summary
        let fileUrl: string | undefined;
        const uploadPromise = audioBlob
          ? (async () => {
              try {
                const mimeType = audioBlob.type || 'audio/webm';
                const { uploadUrl, key } = await getR2UploadUrl(mimeType);
                const putRes = await fetch(uploadUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': mimeType },
                  body: audioBlob,
                });
                if (putRes.ok) {
                  fileUrl = key;
                  console.log(`[endMeeting] Audio uploaded to R2: ${key}`);
                } else {
                  console.warn(`[endMeeting] R2 upload failed: HTTP ${putRes.status}`);
                }
              } catch (uploadErr) {
                console.warn('[endMeeting] R2 upload error (non-fatal):', uploadErr);
              }
            })()
          : Promise.resolve();

        await Promise.all([generateFinalSummary(meetingId, utterances), uploadPromise]);
        await endLiveSession(sessionId, meetingId, elapsed, fileUrl);
        updateSuccess = true;

        // Pendo Track: live session ended
        const approvedCount = aiEvents.filter(e => e.approved === true).length;
        const dismissedCount = aiEvents.filter(e => e.approved === false).length;
        (window as any).pendo?.track('live_session_ended', {
          durationSeconds: elapsed,
          utteranceCount: utterances.length,
          aiEventsCount: aiEvents.length,
          approvedEventsCount: approvedCount,
          dismissedEventsCount: dismissedCount,
          source: 'browser',
          hasFinalSummary: true,
        });
        console.log(`[endMeeting] Successfully finalized meeting ${meetingId}`);
      } catch (err) {
        console.error('[endMeeting] Failed to finalize meeting:', err);
        // Don't throw - still show done screen, but don't auto-navigate
      }
    }

    setTimeout(() => {
      setPhase('done');
      // Only auto-navigate if the status update succeeded
      if (meetingId && updateSuccess) {
        console.log(`[endMeeting] Auto-navigating to meetings page`);
        onNavigate('meetings');
      } else if (meetingId) {
        console.warn(`[endMeeting] Skipping auto-navigation due to update failure`);
      }
    }, 1500);
  };

  const sendChatMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]);
    setIsChatLoading(true);
    // Pendo Track: live chat question asked
    (window as any).pendo?.track('live_chat_question_asked', {
      meetingId: meetingId ?? undefined,
      queryLength: text.length,
      transcriptLengthChars: transcriptBufferRef.current.length,
    });
    try {
      const apiKey = getSetting('OPENROUTER_API_KEY');
      if (!apiKey) throw new Error('OpenRouter API key not configured. Go to Settings → AI Services.');
      const context = transcriptBufferRef.current.slice(-4000);
      const answer = await callOpenRouter(
        apiKey,
        [
          {
            role: 'system',
            content: `You are an AI assistant helping during a live meeting. Answer questions concisely and helpfully based on the transcript context provided.\n\nCurrent transcript:\n${context || '(No transcript yet)'}`,
          },
          { role: 'user', content: text },
        ],
        'live-chat',
      );
      setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'ai', text: answer, timestamp: Date.now() }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'ai', text: `Error: ${msg}`, timestamp: Date.now() }]);
    } finally {
      setIsChatLoading(false);
    }
  }, []);

  const approveEvent = (id: string) => {
    const event = aiEvents.find(e => e.id === id);
    setAiEvents(prev => prev.map(e => e.id === id ? { ...e, approved: true } : e));
    supabase.from('ai_events').update({ approved: true }).eq('id', id).then(() => {});
    // Pendo Track: AI event approved
    (window as any).pendo?.track('ai_event_approved', {
      eventType: event?.type ?? 'unknown',
      confidence: event?.confidence ?? 0,
      meetingId: meetingId ?? undefined,
      sessionId: sessionId ?? undefined,
    });
  };
  const dismissEvent = (id: string) => {
    const event = aiEvents.find(e => e.id === id);
    setAiEvents(prev => prev.map(e => e.id === id ? { ...e, approved: false } : e));
    supabase.from('ai_events').update({ approved: false }).eq('id', id).then(() => {});
    // Pendo Track: AI event dismissed
    (window as any).pendo?.track('ai_event_dismissed', {
      eventType: event?.type ?? 'unknown',
      confidence: event?.confidence ?? 0,
      meetingId: meetingId ?? undefined,
      sessionId: sessionId ?? undefined,
    });
  };

  // ── Setup ──────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="h-full overflow-y-auto">
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
          <div className="flex items-center gap-2 px-4 sm:px-6 py-3.5">
            <button
              onClick={() => onNavigate('dashboard')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[13.5px] font-medium text-foreground">Live Meeting Setup</span>
          </div>
        </div>
        {startError && (
          <div className="mx-4 sm:mx-6 mt-4 flex items-start gap-3 px-4 py-3.5 rounded-xl bg-destructive/8 border border-destructive/25">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-destructive">Failed to start session</p>
              <p className="text-[12px] text-destructive/80 mt-0.5 leading-relaxed">{startError}</p>
            </div>
          </div>
        )}
        <LiveSessionSetup onStart={startMeeting} />
      </div>
    );
  }

  // ── Connecting ─────────────────────────────────────────────────────────────
  if (phase === 'connecting') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-6 p-6">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-200 dark:border-red-500/20 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-red-500 animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-[16px] font-semibold text-foreground">Starting session…</p>
        </div>
      </div>
    );
  }

  // ── Ending ─────────────────────────────────────────────────────────────────
  if (phase === 'ending') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-[16px] font-semibold text-foreground">Finalizing…</p>
          <p className="text-[13px] text-muted-foreground mt-1">Generating final summary and saving to your library</p>
        </div>
      </div>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const approvedActions = aiEvents.filter(e => e.type === 'action_item' && e.approved !== false);
    const approvedDecisions = aiEvents.filter(e => e.type === 'decision' && e.approved !== false);
    const allTranscript = utterances.map(u => `${u.speaker}: ${u.text}`).join('\n\n');
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-full mb-4">
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">Session saved</span>
            </div>
            <h1 className="text-[22px] sm:text-[26px] font-semibold text-foreground">Session Complete</h1>
            <p className="text-[13px] text-muted-foreground mt-1.5">
              {formatTimer(elapsed)} · {utterances.length} segments · {aiEvents.length} AI insights
              {meetingId && (
                <> · <button onClick={() => onNavigate('meetings')} className="text-primary underline hover:no-underline">View in library</button></>
              )}
            </p>
          </div>

          {summary.running && (
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-[13.5px] font-semibold text-foreground mb-3">Summary</h3>
              <p className="text-[13px] text-foreground leading-relaxed">{summary.running}</p>
            </div>
          )}

          {approvedActions.length > 0 && (
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-[13.5px] font-semibold text-foreground mb-3">Action Items ({approvedActions.length})</h3>
              <div className="flex flex-col gap-2">
                {approvedActions.map(e => (
                  <div key={e.id} className="flex items-start gap-2.5 p-2.5 bg-violet-500/[0.06] border border-violet-500/15 rounded-xl">
                    <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <div>
                      {e.owner && <p className="text-[10.5px] font-semibold text-violet-600 dark:text-violet-400">{e.owner}{e.dueDate ? ` · Due ${e.dueDate}` : ''}</p>}
                      <p className="text-[12.5px] text-foreground">{e.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {approvedDecisions.length > 0 && (
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-[13.5px] font-semibold text-foreground mb-3">Key Decisions</h3>
              <div className="flex flex-col gap-2">
                {approvedDecisions.map(e => (
                  <div key={e.id} className="flex items-start gap-2.5">
                    <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[12.5px] text-foreground">{e.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2.5 flex-wrap">
            <Button className="gap-2"><Mail className="w-3.5 h-3.5" />Send Email</Button>
            <Button variant="outline" className="gap-2" onClick={() => {
              navigator.clipboard.writeText(allTranscript);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}>
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Transcript'}
            </Button>
            <Button variant="outline" className="gap-2"><Download className="w-3.5 h-3.5" />Export PDF</Button>
            <Button variant="outline" onClick={() => onNavigate('meetings')} className="gap-2">
              <ArrowRight className="w-3.5 h-3.5" />View in Meetings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Live / Paused ──────────────────────────────────────────────────────────
  const isLive = phase === 'live';

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* TOP BAR */}
      <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 border-b border-border bg-card">
        {/* Status indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/60 flex-shrink-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isLive ? 'bg-red-500 animate-pulse' : 'bg-muted-foreground'}`} />
          <span className={`text-[11px] font-bold tracking-wider ${isLive ? 'text-red-500' : 'text-muted-foreground'}`}>
            {isLive ? 'REC' : 'PAUSED'}
          </span>
        </div>

        {/* Timer */}
        <div className="font-mono text-[15px] sm:text-[16px] font-semibold text-foreground tracking-widest flex-shrink-0">
          {formatTimer(elapsed)}
        </div>

        {/* WS Status */}
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/60 flex-shrink-0">
          {wsStatus === 'connected'
            ? <><Wifi className="w-3.5 h-3.5 text-emerald-500" /><span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Nova-3</span></>
            : wsStatus === 'reconnecting'
            ? <><Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" /><span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Reconnecting…</span></>
            : <><WifiOff className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[11px] font-medium text-muted-foreground">Off</span></>}
        </div>

        {/* Active speaker */}
        {activeSpeaker && isLive && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 flex-shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">{activeSpeaker}</span>
          </div>
        )}

        {/* Marked moments */}
        {markedMoments.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 flex-shrink-0">
            <Star className="w-3 h-3 text-amber-500" />
            <span className="text-[11px] text-amber-600 dark:text-amber-400">{markedMoments.length}</span>
          </div>
        )}

        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={markImportant}
            className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-accent transition-colors"
          >
            <Star className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden md:inline">Mark</span>
          </button>
          <button
            onClick={pauseResume}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent hover:bg-accent/80 text-foreground transition-colors"
          >
            {isLive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <Button
            onClick={endMeeting}
            size="sm"
            className="gap-1.5 h-8 px-2.5 sm:px-3 bg-red-500 hover:bg-red-600 text-white border-0 shadow-sm shadow-red-500/25"
          >
            <Square className="w-3 h-3" />
            <span className="hidden xs:inline">End</span>
          </Button>
        </div>
      </div>

      {/* Transcription error banner */}
      {wsError && wsStatus === 'disconnected' && (
        <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2.5 bg-destructive/8 border-b border-destructive/20">
          <WifiOff className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
          <p className="text-[12px] text-destructive flex-1">{wsError}</p>
          <button
            onClick={() => setWsError(null)}
            className="text-destructive/60 hover:text-destructive transition-colors text-[11px] font-medium flex-shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile panel switcher */}
      <div className="lg:hidden flex border-b border-border bg-card flex-shrink-0">
        <button
          onClick={() => setMobilePanel('transcript')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-[12px] font-medium transition-colors ${
            mobilePanel === 'transcript'
              ? 'text-primary border-b-2 border-primary bg-primary/3'
              : 'text-muted-foreground'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Transcript
        </button>
        <button
          onClick={() => setMobilePanel('copilot')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-[12px] font-medium transition-colors ${
            mobilePanel === 'copilot'
              ? 'text-primary border-b-2 border-primary bg-primary/3'
              : 'text-muted-foreground'
          }`}
        >
          <Brain className="w-3.5 h-3.5" />
          AI Copilot
          {aiEvents.length > 0 && (
            <span className="w-4 h-4 flex items-center justify-center rounded-full bg-violet-500 text-white text-[9px] font-bold">
              {aiEvents.length > 9 ? '9+' : aiEvents.length}
            </span>
          )}
        </button>
      </div>

      {/* BODY */}
      <div className="flex-1 overflow-hidden flex">

        {/* Mobile: single toggled panel */}
        <div className="lg:hidden flex-1 flex flex-col overflow-hidden">
          {mobilePanel === 'transcript' ? (
            <>
              <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-card/50">
                <LiveWaveform micStream={micStream} active={isLive} height={36} color={isLive ? '#ef4444' : '#6b7280'} />
              </div>
              <div className="flex-1 overflow-hidden">
                <LiveTranscriptPanel
                  utterances={utterances}
                  streamingWords={streamingWords}
                  streamingSpeaker={streamingSpeaker}
                  activeSpeaker={activeSpeaker}
                  elapsed={elapsed}
                  isLive={isLive}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-hidden">
              <LiveCopilotPanel
                events={aiEvents}
                summary={summary}
                isSummaryUpdating={isSummaryUpdating}
                onApprove={approveEvent}
                onDismiss={dismissEvent}
                onExportToSheets={() => {}}
                chatMessages={chatMessages}
                isChatLoading={isChatLoading}
                onSendChat={sendChatMessage}
                coachingPrompts={coachingPrompts}
                utteranceSentiments={utteranceSentiments}
                agendaItems={agendaItems}
              />
            </div>
          )}
        </div>

        {/* Desktop: split panel */}
        <div className="hidden lg:flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-border bg-card/50">
              <LiveWaveform micStream={micStream} active={isLive} height={40} color={isLive ? '#ef4444' : '#6b7280'} />
            </div>
            <div className="flex-1 overflow-hidden">
              <LiveTranscriptPanel
                utterances={utterances}
                streamingWords={streamingWords}
                streamingSpeaker={streamingSpeaker}
                activeSpeaker={activeSpeaker}
                elapsed={elapsed}
                isLive={isLive}
              />
            </div>
          </div>
          <div className="w-[340px] xl:w-[380px] flex-shrink-0 overflow-hidden flex flex-col">
            <LiveCopilotPanel
              events={aiEvents}
              summary={summary}
              isSummaryUpdating={isSummaryUpdating}
              onApprove={approveEvent}
              onDismiss={dismissEvent}
              onExportToSheets={() => {}}
              chatMessages={chatMessages}
              isChatLoading={isChatLoading}
              onSendChat={sendChatMessage}
              coachingPrompts={coachingPrompts}
              utteranceSentiments={utteranceSentiments}
              agendaItems={agendaItems}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

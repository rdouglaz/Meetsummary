import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type TranscriptChunkInsert = Database['public']['Tables']['transcript_chunks']['Insert'];
type AIEventInsert = Database['public']['Tables']['ai_events']['Insert'];

// ─── Session lifecycle ────────────────────────────────────────────────────────
export async function createLiveSession(source: string, settings: Record<string, unknown>, agendaItems?: string[]) {
  const { data: { user } } = await supabase.auth.getUser();

  // Create meeting record first
  const { data: meeting, error: mErr } = await supabase
    .from('meetings')
    .insert({
      title:        `Live Meeting — ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      source:       source as 'browser',
      status:       'uploading',
      progress:     0,
      user_id:      user?.id ?? null,
      agenda_items: agendaItems ?? [],
    })
    .select()
    .single();

  if (mErr || !meeting) throw new Error(mErr?.message ?? 'Failed to create meeting');

  const { data: session, error: sErr } = await supabase
    .from('live_sessions')
    .insert({ meeting_id: meeting.id, source, settings, status: 'active', user_id: user?.id ?? null })
    .select()
    .single();

  if (sErr || !session) throw new Error(sErr?.message ?? 'Failed to create session');

  // Update meeting to live/browser source
  const { error: updateErr } = await supabase
    .from('meetings')
    .update({ status: 'transcribing', progress: 10 })
    .eq('id', meeting.id)
    .select();

  if (updateErr) {
    console.error('[createLiveSession] Failed to update meeting status to transcribing:', updateErr);
  }

  console.log(`[createLiveSession] Created session ${session.id} for meeting ${meeting.id}`);

  return { session, meeting };
}

export async function endLiveSession(sessionId: string, meetingId: string, durationSeconds = 0, fileUrl?: string) {
  const meetingUpdate: Record<string, unknown> = {
    status: 'complete',
    progress: 100,
    duration: Math.round(durationSeconds),
  };
  if (fileUrl) meetingUpdate.file_url = fileUrl;

  const [sessionResult, meetingResult] = await Promise.all([
    supabase
      .from('live_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select(),
    supabase
      .from('meetings')
      .update(meetingUpdate)
      .eq('id', meetingId)
      .select(),
  ]);

  // Check for errors and log them
  if (sessionResult.error) {
    console.error('[endLiveSession] Failed to update live_session:', sessionResult.error);
  }
  if (meetingResult.error) {
    console.error('[endLiveSession] CRITICAL: Failed to update meeting status to complete:', {
      error: meetingResult.error,
      meetingId,
      duration: durationSeconds,
    });
    throw new Error(`Failed to mark meeting as complete: ${meetingResult.error.message}`);
  }

  // Verify the meeting was actually updated
  if (!meetingResult.data || meetingResult.data.length === 0) {
    console.error('[endLiveSession] CRITICAL: Meeting update returned 0 rows (RLS policy issue or invalid meeting ID):', {
      meetingId,
      sessionId,
    });
    throw new Error(`Failed to update meeting ${meetingId} - record not found or permission denied`);
  }

  console.log(`[endLiveSession] ✓ Successfully ended session and marked meeting as complete:`, {
    sessionId,
    meetingId,
    status: meetingResult.data[0].status,
    progress: meetingResult.data[0].progress,
  });
}

export async function abortLiveSession(sessionId: string, meetingId: string) {
  const [sessionResult, meetingResult] = await Promise.all([
    supabase
      .from('live_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select(),
    supabase
      .from('meetings')
      .update({ status: 'error', progress: 0 })
      .eq('id', meetingId)
      .select(),
  ]);

  if (sessionResult.error) {
    console.error('[abortLiveSession] Failed to update live_session:', sessionResult.error);
  }
  if (meetingResult.error) {
    console.error('[abortLiveSession] Failed to update meeting:', meetingResult.error);
  }

  console.log(`[abortLiveSession] Aborted session ${sessionId} and marked meeting ${meetingId} as error`);
}

export async function pauseLiveSession(sessionId: string) {
  await supabase.from('live_sessions').update({ status: 'paused' }).eq('id', sessionId);
}

export async function resumeLiveSession(sessionId: string) {
  await supabase.from('live_sessions').update({ status: 'active' }).eq('id', sessionId);
}

// ─── Transcript persistence ───────────────────────────────────────────────────
export async function saveTranscriptChunk(chunk: TranscriptChunkInsert) {
  const { error } = await supabase.from('transcript_chunks').insert(chunk);
  if (error) console.error('Failed to save transcript chunk:', error);
}

// ─── AI event persistence ─────────────────────────────────────────────────────
export async function saveAIEvent(event: AIEventInsert) {
  const { data, error } = await supabase
    .from('ai_events')
    .insert(event)
    .select()
    .single();
  if (error) console.error('Failed to save AI event:', error);
  return data;
}

// ─── Running summary update ───────────────────────────────────────────────────
export async function upsertRunningSummary(meetingId: string, text: string) {
  const { data: existing } = await supabase
    .from('summaries')
    .select('id')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('summaries')
      .update({ overview: { running: text }, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase.from('summaries').insert({
      meeting_id: meetingId,
      overview: { running: text },
      mode: 'short',
    });
  }
}

// ─── Load session transcript (for multi-user join) ───────────────────────────
export async function loadSessionTranscript(sessionId: string) {
  try {
    const { data } = await supabase
      .from('transcript_chunks')
      .select('*')
      .eq('session_id', sessionId)
      .eq('is_final', true)
      .order('timestamp_start');
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Load session AI events ───────────────────────────────────────────────────
export async function loadSessionAIEvents(sessionId: string) {
  try {
    const { data } = await supabase
      .from('ai_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at');
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Realtime subscription for transcript ─────────────────────────────────────
export function subscribeToTranscript(
  sessionId: string,
  onChunk: (chunk: Database['public']['Tables']['transcript_chunks']['Row']) => void,
) {
  return supabase
    .channel(`transcript:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'transcript_chunks',
        filter: `session_id=eq.${sessionId}`,
      },
      payload => onChunk(payload.new as Database['public']['Tables']['transcript_chunks']['Row']),
    )
    .subscribe();
}

// ─── Realtime subscription for AI events ─────────────────────────────────────
export function subscribeToAIEvents(
  sessionId: string,
  onEvent: (event: Database['public']['Tables']['ai_events']['Row']) => void,
) {
  return supabase
    .channel(`ai_events:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'ai_events',
        filter: `session_id=eq.${sessionId}`,
      },
      payload => onEvent(payload.new as Database['public']['Tables']['ai_events']['Row']),
    )
    .subscribe();
}

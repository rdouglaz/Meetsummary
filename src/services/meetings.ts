import { supabase }       from '../lib/supabase';
import type { Database }  from '../lib/database.types';
import type { DGUtterance } from '../lib/deepgram-rest';

type MeetingRow    = Database['public']['Tables']['meetings']['Row'];
type ActionItemRow = Database['public']['Tables']['action_items']['Row'];
type SummaryRow    = Database['public']['Tables']['summaries']['Row'];

export interface MeetingWithSummary extends MeetingRow {
  summary:      SummaryRow | null;
  action_items: ActionItemRow[];
}

// ─── Stats ────────────────────────────────────────────────────────────────────
export async function fetchStats() {
  try {
    const [{ count: totalMeetings }, { data: durationsData }, { count: totalActions }] = await Promise.all([
      supabase.from('meetings').select('*', { count: 'exact', head: true }),
      supabase.from('meetings').select('duration').eq('status', 'complete'),
      supabase.from('action_items').select('*', { count: 'exact', head: true }),
    ]);
    const totalSeconds   = (durationsData ?? []).reduce((s, m) => s + (m.duration ?? 0), 0);
    const hoursTranscribed = Math.round((totalSeconds / 3600) * 10) / 10;
    return {
      totalMeetings:       totalMeetings ?? 0,
      hoursTranscribed,
      actionItemsGenerated: totalActions ?? 0,
      timeSavedHours:      Math.round(hoursTranscribed * 0.4 * 10) / 10,
    };
  } catch {
    return { totalMeetings: 0, hoursTranscribed: 0, actionItemsGenerated: 0, timeSavedHours: 0 };
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function fetchMeetings(): Promise<MeetingRow[]> {
  try {
    const { data } = await supabase
      .from('meetings')
      .select('*')
      .order('created_at', { ascending: false });
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Single meeting with full data ────────────────────────────────────────────
export async function fetchMeetingDetail(meetingId: string): Promise<MeetingWithSummary | null> {
  try {
    const [meetingRes, summaryRes, actionsRes] = await Promise.all([
      supabase.from('meetings').select('*').eq('id', meetingId).single(),
      supabase.from('summaries').select('*').eq('meeting_id', meetingId).maybeSingle(),
      supabase.from('action_items').select('*').eq('meeting_id', meetingId).order('created_at'),
    ]);
    if (meetingRes.error || !meetingRes.data) return null;
    return {
      ...meetingRes.data,
      summary:      summaryRes.data ?? null,
      action_items: actionsRes.data ?? [],
    };
  } catch {
    return null;
  }
}

// ─── Transcript chunks ─────────────────────────────────────────────────────────
export async function fetchTranscriptChunks(meetingId: string) {
  try {
    const { data } = await supabase
      .from('transcript_chunks')
      .select('*')
      .eq('meeting_id', meetingId)
      .eq('is_final', true)
      .order('timestamp_start');
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── AI events ────────────────────────────────────────────────────────────────
export async function fetchAIEvents(meetingId: string) {
  try {
    const { data } = await supabase
      .from('ai_events')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at');
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Action items ─────────────────────────────────────────────────────────────
export async function fetchAllActionItems() {
  try {
    const { data } = await supabase
      .from('action_items')
      .select('*, meetings(title)')
      .order('created_at', { ascending: false });
    return data ?? [];
  } catch {
    return [];
  }
}

export async function updateActionItemStatus(id: string, status: 'pending' | 'in_progress' | 'complete') {
  try {
    await supabase.from('action_items').update({ status }).eq('id', id);
  } catch { /* best-effort */ }
}

// ─── AI event helpers ─────────────────────────────────────────────────────────
export async function updateAIEventApproval(id: string, approved: boolean) {
  try {
    await supabase.from('ai_events').update({ approved }).eq('id', id);
  } catch { /* best-effort */ }
}

export async function saveActionItemFromEvent(meetingId: string, content: string, owner?: string, dueDate?: string) {
  try {
    await supabase.from('action_items').insert({
      meeting_id: meetingId,
      task:       content,
      owner:      owner ?? null,
      due_date:   dueDate ?? null,
      status:     'pending',
    });
  } catch { /* best-effort */ }
}

export async function updateMeetingProgress(id: string, status: MeetingRow['status'], progress: number) {
  try {
    const { error, data } = await supabase
      .from('meetings')
      .update({ status, progress })
      .eq('id', id)
      .select();

    if (error) {
      console.error(`[updateMeetingProgress] Failed to update meeting ${id}:`, error);
      return;
    }

    if (!data || data.length === 0) {
      console.warn(`[updateMeetingProgress] Meeting ${id} not found or permission denied`);
      return;
    }

    console.log(`[updateMeetingProgress] Updated meeting ${id} to ${status} (${progress}%)`);
  } catch (err) {
    console.error(`[updateMeetingProgress] Exception:`, err);
  }
}

// ─── Browser-pipeline save ────────────────────────────────────────────────────
// Saves ONLY text outputs from the browser pipeline — no audio/video stored.

interface PipelineSummary {
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

interface SavePipelineArgs {
  title:        string;
  fileName:     string;
  fileSize:     number;
  fileUrl:      string | null;
  source:       MeetingRow['source'];
  duration:     number;
  mode:         'short' | 'client';
  utterances:   DGUtterance[];
  summary:      PipelineSummary | null;
  agendaItems?: string[];
}

export async function savePipelineResult(args: SavePipelineArgs): Promise<string> {
  const { title, fileName, fileSize, fileUrl, source, duration, mode, utterances, summary, agendaItems } = args;

  // Attach the authenticated user so RLS can scope the row
  const { data: { user } } = await supabase.auth.getUser();

  // 1. Create meeting row (complete — no backend processing needed)
  const { data: meeting, error: meetingErr } = await supabase
    .from('meetings')
    .insert({
      title,
      user_id:      user?.id ?? null,
      file_url:     fileUrl ?? null,
      file_name:    fileName,
      file_size:    fileSize,
      source,
      status:       'complete',
      progress:     100,
      duration:     Math.round(duration),
      agenda_items: agendaItems ?? [],
    })
    .select('id')
    .single();

  if (meetingErr || !meeting?.id) {
    throw new Error(meetingErr?.message ?? 'Failed to create meeting record. Check Supabase RLS policies.');
  }

  const mId = meeting.id;

  // 2. Bulk insert transcript chunks (all final)
  if (utterances.length > 0) {
    const speakerLabel = (n: number) => `Speaker ${n + 1}`;
    const chunks = utterances.map(u => ({
      meeting_id:      mId,
      session_id:      null,
      speaker:         speakerLabel(u.speaker),
      text:            u.transcript,
      timestamp_start: u.start,
      timestamp_end:   u.end,
      is_final:        true,
      words:           u.words as unknown as Database['public']['Tables']['transcript_chunks']['Row']['words'],
    }));
    // Insert in batches of 100 to avoid payload limits
    for (let i = 0; i < chunks.length; i += 100) {
      await supabase.from('transcript_chunks').insert(chunks.slice(i, i + 100));
    }
  }

  // 3. Insert summary (if generated)
  if (summary) {
    await supabase.from('summaries').insert({
      meeting_id:           mId,
      overview:             summary.overview as Database['public']['Tables']['summaries']['Row']['overview'],
      key_discussion_points: summary.keyDiscussionPoints,
      key_decisions:        summary.keyDecisions,
      follow_up_email:      summary.followUpEmail,
      risks:                summary.risks,
      mode,
    });

    // 4. Bulk insert action items extracted by the LLM
    if (summary.actionItems.length > 0) {
      await supabase.from('action_items').insert(
        summary.actionItems.map(ai => ({
          meeting_id: mId,
          task:       ai.task,
          owner:      ai.owner,
          due_date:   ai.dueDate,
          status:     'pending' as const,
        })),
      );
    }
  }

  return mId;
}

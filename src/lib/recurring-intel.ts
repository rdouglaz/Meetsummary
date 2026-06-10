import { supabase } from './supabase';

export interface RecurringItem {
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  task: string;
  owner: string | null;
  dueDate: string | null;
}

export async function findRecurringOpenItems(
  currentMeetingId: string,
  currentTitle: string,
  limitDays = 90,
): Promise<RecurringItem[]> {
  if (!currentTitle || currentTitle.trim().length < 4) return [];

  const prefix = currentTitle.split(/\s+/).slice(0, 4).join(' ').slice(0, 40);
  const since = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: pastMeetings } = await supabase
    .from('meetings')
    .select('id, title, created_at')
    .ilike('title', `${prefix}%`)
    .neq('id', currentMeetingId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!pastMeetings || pastMeetings.length === 0) return [];

  const meetingIds = pastMeetings.map(m => m.id);

  const { data: items } = await supabase
    .from('action_items')
    .select('id, task, owner, due_date, meeting_id, status')
    .in('meeting_id', meetingIds)
    .eq('status', 'pending')
    .limit(20);

  if (!items || items.length === 0) return [];

  return items.map(item => {
    const meeting = pastMeetings.find(m => m.id === item.meeting_id);
    return {
      meetingId: item.meeting_id ?? '',
      meetingTitle: meeting?.title ?? 'Past meeting',
      meetingDate: meeting?.created_at ?? '',
      task: item.task,
      owner: item.owner,
      dueDate: item.due_date,
    };
  });
}

/**
 * Slack / Microsoft Teams notification client.
 * Browser can't POST to incoming webhooks directly (CORS). Relay via Supabase Edge Function.
 */
import { supabase } from './supabase';
import { getSetting } from './exports';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://zqhttqqsjowkdwyockrp.supabase.co';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/post-notification`;

export interface NotifyPayload {
  meetingTitle: string;
  summary: string;
  actionItems: string[];
  meetingUrl?: string;
}

async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function relay(
  platform: 'slack' | 'teams',
  webhookUrl: string,
  payload: NotifyPayload,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({ platform, webhookUrl, ...payload }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function notifySlack(payload: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = getSetting('SLACK_WEBHOOK_URL').trim();
  if (!webhookUrl) return { ok: false, error: 'Slack webhook URL not configured in Settings → Notifications' };
  if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
    return { ok: false, error: 'Invalid Slack webhook URL — must start with https://hooks.slack.com/' };
  }
  return relay('slack', webhookUrl, payload);
}

export async function notifyTeams(payload: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = getSetting('TEAMS_WEBHOOK_URL').trim();
  if (!webhookUrl) return { ok: false, error: 'Teams webhook URL not configured in Settings → Notifications' };
  return relay('teams', webhookUrl, payload);
}

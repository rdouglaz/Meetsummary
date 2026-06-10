/**
 * CRM sync client — relays to the crm-sync Edge Function to avoid CORS/auth issues.
 * Supports HubSpot (Private App Token) and Salesforce (OAuth username+password flow).
 */
import { supabase } from './supabase';
import { getSetting } from './exports';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://zqhttqqsjowkdwyockrp.supabase.co';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/crm-sync`;

export interface CRMPayload {
  meetingTitle: string;
  summary: string;
  actionItems: string[];
  contactEmail?: string;
}

async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

export async function syncToHubSpot(payload: CRMPayload): Promise<{ ok: boolean; error?: string }> {
  const apiKey = getSetting('HUBSPOT_API_KEY').trim();
  if (!apiKey) return { ok: false, error: 'HubSpot Private App Token not configured in Settings → Export Integrations' };

  try {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({ crm: 'hubspot', ...payload, credentials: { apiKey } }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    // Pendo Track: CRM sync completed
    (window as any).pendo?.track('crm_sync_completed', {
      crmType: 'hubspot',
      meetingTitle: payload.meetingTitle?.slice(0, 100),
      actionItemCount: payload.actionItems?.length ?? 0,
      contactLinked: !!payload.contactEmail,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function syncToSalesforce(payload: CRMPayload): Promise<{ ok: boolean; error?: string }> {
  const instanceUrl    = getSetting('SALESFORCE_INSTANCE_URL').trim();
  const clientId       = getSetting('SALESFORCE_CLIENT_ID').trim();
  const clientSecret   = getSetting('SALESFORCE_CLIENT_SECRET').trim();
  const username       = getSetting('SALESFORCE_USERNAME').trim();
  const password       = getSetting('SALESFORCE_PASSWORD').trim();
  const securityToken  = getSetting('SALESFORCE_TOKEN').trim();

  if (!instanceUrl || !clientId || !username || !password) {
    return { ok: false, error: 'Salesforce credentials incomplete — configure all fields in Settings → CRM' };
  }

  try {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({
        crm: 'salesforce',
        ...payload,
        credentials: { instanceUrl, clientId, clientSecret, username, password, securityToken },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    // Pendo Track: CRM sync completed
    (window as any).pendo?.track('crm_sync_completed', {
      crmType: 'salesforce',
      meetingTitle: payload.meetingTitle?.slice(0, 100),
      actionItemCount: payload.actionItems?.length ?? 0,
      contactLinked: !!payload.contactEmail,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * R2 client — browser side.
 *
 * Never holds R2 credentials. All operations are proxied through the
 * r2-presign Supabase Edge Function which validates the caller's JWT
 * and enforces ownership (keys are prefixed with the user's UID).
 */

import { supabase } from './supabase';

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  'https://zqhttqqsjowkdwyockrp.supabase.co';

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/r2-presign`;

async function callPresign(body: Record<string, string>): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated — sign in to use audio storage.');

  const res = await fetch(FUNCTION_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json() as Record<string, string>;
  if (!res.ok) throw new Error(json.error ?? `r2-presign: ${res.status}`);
  return json;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Request a presigned PUT URL and the object key to store in the DB. */
export async function getR2UploadUrl(contentType?: string): Promise<{ uploadUrl: string; key: string }> {
  const body: Record<string, string> = { action: 'upload' };
  if (contentType) body.contentType = contentType;
  const { uploadUrl, key } = await callPresign(body);
  return { uploadUrl, key };
}

/** Request a short-lived (1 h) signed GET URL to stream audio from R2. */
export async function getR2DownloadUrl(key: string): Promise<string> {
  const { url } = await callPresign({ action: 'download', key });
  return url;
}

/** Delete the R2 object when deleting a meeting. */
export async function deleteR2Object(key: string): Promise<void> {
  await callPresign({ action: 'delete', key });
}

/**
 * Returns true when a `file_url` value is an R2 object key rather than a
 * legacy Supabase Storage public URL.
 * R2 keys look like: "<userId>/<uuid>.wav"
 * Supabase URLs look like: "https://..."
 */
export function isR2Key(value: string | null | undefined): value is string {
  return Boolean(value && !value.startsWith('https://') && !value.startsWith('http://'));
}

/**
 * r2-presign — Supabase Edge Function
 *
 * Generates short-lived presigned URLs for Cloudflare R2 (S3-compatible API).
 * R2 credentials are stored as Supabase secrets and never exposed to the browser.
 *
 * Actions:
 *   upload  → presigned PUT URL valid for 1 h + the object key to store in DB
 *   download → presigned GET URL valid for 1 h (user must own the key)
 *   delete  → deletes the R2 object (user must own the key)
 *
 * Required Supabase secrets (supabase secrets set --env-file .env.r2):
 *   R2_ENDPOINT          — https://<account-id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID     — R2 API token "Access Key ID"
 *   R2_SECRET_ACCESS_KEY — R2 API token "Secret Access Key"
 *   R2_BUCKET_NAME       — bucket name (private, no public access)
 *
 * R2 lifecycle (set once in Cloudflare dashboard):
 *   Bucket → Settings → Object lifecycle rules → Expire after 7 days
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── R2 client (S3-compatible) ────────────────────────────────────────────────
const BUCKET = Deno.env.get("R2_BUCKET_NAME")!;

const s3 = new S3Client({
  region:   "auto",
  endpoint: Deno.env.get("R2_ENDPOINT")!, // e.g. https://<account-id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId:     Deno.env.get("R2_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  },
  // AWS SDK v3 adds x-amz-checksum-* headers by default; R2 does not support them.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Authenticate the caller via Supabase JWT
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: { action?: string; key?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, key, contentType } = body;

  // Ownership guard — every R2 key is prefixed with the user's UID
  const ownsKey = (k: string | undefined): k is string =>
    Boolean(k && k.startsWith(`${user.id}/`));

  try {
    // ── upload ──────────────────────────────────────────────────────────────
    if (action === "upload") {
      const ext = contentType === "audio/webm" || contentType?.startsWith("audio/webm")
        ? "webm"
        : "wav";
      const objectKey = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const cmd: ConstructorParameters<typeof PutObjectCommand>[0] = {
        Bucket: BUCKET,
        Key:    objectKey,
      };
      if (contentType) cmd.ContentType = contentType;
      const uploadUrl = await getSignedUrl(s3, new PutObjectCommand(cmd), { expiresIn: 3600 });
      return json({ uploadUrl, key: objectKey });
    }

    // ── download ─────────────────────────────────────────────────────────────
    if (action === "download") {
      if (!ownsKey(key)) return json({ error: "Forbidden" }, 403);
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        { expiresIn: 3600 },
      );
      return json({ url });
    }

    // ── delete ────────────────────────────────────────────────────────────────
    if (action === "delete") {
      if (!ownsKey(key)) return json({ error: "Forbidden" }, 403);
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return json({ ok: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("r2-presign error:", msg);
    return json({ error: msg }, 500);
  }
});

# MeetSummary - Deployment Guide

## Prerequisites

- Supabase project created at [supabase.com](https://supabase.com)
- Deepgram API key (get it at [deepgram.com](https://deepgram.com))
- OpenRouter API key (get it at [openrouter.ai](https://openrouter.ai))
- Cloudflare account with R2 enabled

---

## Step 1: Create Database Tables

1. Go to **Supabase Dashboard → SQL Editor**
2. Copy the contents of `supabase/schema.sql`
3. Run the SQL script to create all tables, triggers, and RLS policies

---

## Step 2: Set Up Cloudflare R2

### 2a. Create the bucket

1. Cloudflare Dashboard → **R2 Object Storage** → **Create bucket**
2. Name it (e.g. `meetsummary-recordings`)
3. Leave **public access disabled** (private bucket)

### 2b. Configure CORS (required for browser uploads)

The browser uploads compressed WAV directly to R2 via a presigned URL. Without a CORS policy the preflight request fails.

**Option A — Cloudflare Dashboard:**
1. Open the bucket → **Settings** → **CORS Policy**
2. Paste the contents of `supabase/r2-cors.json` and save

**Option B — Wrangler CLI:**
```bash
wrangler r2 bucket cors set meetsummary-recordings --file supabase/r2-cors.json
```

The policy allows `GET`, `PUT`, and `HEAD` from `https://meetsummary-rust.vercel.app`.
If you deploy to a different domain, add it to `AllowedOrigins` in `supabase/r2-cors.json` and re-apply.

### 2c. Set the 7-day auto-expiry lifecycle rule

1. Open the bucket → **Settings** → **Object lifecycle rules**
2. Click **Add rule**
   - Rule name: `expire-7-days`
   - Filter: leave blank (applies to all objects)
   - Action: **Expire current versions of objects**
   - Days after upload: **7**
3. Save

### 2d. Create an API token

1. Cloudflare Dashboard → **R2** → **Manage R2 API tokens** → **Create API token**
2. Permissions: **Object Read & Write**
3. Specify bucket: select your bucket
4. Click **Create API token** — copy the **Access Key ID** and **Secret Access Key**

**Your R2 S3-compatible endpoint:**
```
https://3a99438bac6fe15cfdd247ed6efa34b2.r2.cloudflarestorage.com
```

---

## Step 3: Deploy Edge Functions

Three Edge Functions are required. All other processing (transcription, summarization) runs entirely client-side using API keys stored in the user's browser settings.

```bash
# Navigate to project root
cd /path/to/meetsummary

# R2 presigned URL proxy (browser can't sign R2 requests directly)
supabase functions deploy r2-presign --project-ref zqhttqqsjowkdwyockrp

# Slack / Teams notification relay (CORS prevents direct browser → webhook POST)
supabase functions deploy post-notification --project-ref zqhttqqsjowkdwyockrp

# HubSpot / Salesforce CRM sync
supabase functions deploy crm-sync --project-ref zqhttqqsjowkdwyockrp
```

> **Do not deploy** `transcribe`, `summarize`, `deepgram-proxy`, or `send-email` — these are unused and `transcribe` in particular will corrupt meeting status if deployed with a database webhook.

---

## Step 4: Configure Edge Function Secrets

Go to **Supabase Dashboard → Edge Functions → Secrets** and add:

```bash
# Cloudflare R2 (used by r2-presign)
R2_ENDPOINT=https://3a99438bac6fe15cfdd247ed6efa34b2.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=meetsummary-recordings
```

Or via CLI:
```bash
supabase secrets set \
  R2_ENDPOINT=https://3a99438bac6fe15cfdd247ed6efa34b2.r2.cloudflarestorage.com \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_BUCKET_NAME=meetsummary-recordings \
  --project-ref zqhttqqsjowkdwyockrp
```

### Built-in Secrets (auto-populated by Supabase):

- `SUPABASE_URL` — Your project's API URL
- `SUPABASE_SECRET_KEYS` — JSON dictionary of secret API keys

> **Note:** `DEEPGRAM_API_KEY` and `OPENROUTER_API_KEY` are **not** Edge Function secrets — users enter them directly in the app under **Settings → AI Services**. They are stored in the browser and used client-side only.

---

## Step 5: Configure Frontend Environment Variables

Create a `.env.local` file in the project root:

```bash
VITE_SUPABASE_URL=https://zqhttqqsjowkdwyockrp.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
```

Get these values from:
**Supabase Dashboard → Settings → API → Project API keys**

- `VITE_SUPABASE_URL` = Project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` = `anon` / `public` key (safe for browser use)

---

## Step 6: Build and Deploy Frontend

### Local Development:
```bash
pnpm install
pnpm dev
```

### Production Build:
```bash
pnpm build
```

Deploy the `dist/` folder to Vercel, Netlify, Cloudflare Pages, or any static hosting service.

---

## Verification Checklist

✅ Database tables created (run `schema.sql`)  
✅ R2 bucket created (private, no public access)  
✅ R2 lifecycle rule set (expire after 7 days)  
✅ R2 API token created (Object Read & Write, scoped to bucket)  
✅ Edge Functions deployed: `r2-presign`, `post-notification`, `crm-sync`  
✅ Edge Function secrets configured (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`)  
✅ **No database webhooks configured** (verify under Dashboard → Database → Webhooks)  
✅ Frontend `.env.local` configured  
✅ App runs locally with `pnpm dev`  
✅ Upload a file → meeting appears as **Completed** immediately in the list

---

## Troubleshooting

### Meeting stuck at "Transcribing" after upload:
- Go to **Supabase Dashboard → Database → Webhooks** and confirm there are no webhooks on the `meetings` table
- A webhook pointing to the `transcribe` function will overwrite meeting status on every INSERT — delete it if present
- Also delete the `transcribe` and `summarize` Edge Functions from the dashboard if they were previously deployed

### R2 upload fails:
- Verify CORS policy is applied to the bucket (Step 2b)
- Confirm `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` secrets are set
- Check Edge Function logs: **Dashboard → Edge Functions → r2-presign → Logs**

### Slack / Teams notifications not sending:
- Verify the webhook URL is configured in **Settings → Notifications** inside the app
- Check Edge Function logs: **Dashboard → Edge Functions → post-notification → Logs**

### Frontend auth issues:
- Verify you're using `VITE_SUPABASE_PUBLISHABLE_KEY` (the `anon` key), NOT a secret key
- Check RLS policies are enabled on all tables
- Ensure `.env.local` variables are loaded (restart dev server after changes)

---

## API Key Reference

### Edge Function Secrets (Supabase Dashboard)
| Secret | Used by | Required |
|--------|---------|----------|
| `R2_ENDPOINT` | `r2-presign` | ✅ |
| `R2_ACCESS_KEY_ID` | `r2-presign` | ✅ |
| `R2_SECRET_ACCESS_KEY` | `r2-presign` | ✅ |
| `R2_BUCKET_NAME` | `r2-presign` | ✅ |
| `SUPABASE_URL` | all functions | auto |
| `SUPABASE_SECRET_KEYS` | all functions | auto |

### User-Configured Keys (Settings → AI Services inside the app)
| Key | Used for |
|-----|----------|
| `DEEPGRAM_API_KEY` | Audio transcription (client-side) |
| `OPENROUTER_API_KEY` | AI summarization (client-side) |
| `SLACK_WEBHOOK_URL` | Slack notifications |
| `TEAMS_WEBHOOK_URL` | Teams notifications |
| `HUBSPOT_API_KEY` | HubSpot CRM sync |
| `SALESFORCE_*` | Salesforce CRM sync |

---

## Supabase API Key Reference

**Current (use these):**
- `SUPABASE_PUBLISHABLE_KEYS` — client-side, browser-safe ✅
- `SUPABASE_SECRET_KEYS` — server-side, admin-level access ✅

Both are JSON dictionaries. Extract a value before use:
```typescript
const key = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')).at(0);
```

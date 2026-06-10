# Plan: Speaker Diarization Fix + Agenda → AI-Structured Minutes → PDF Export

> Previous bug fixes (Deepgram 408, live meeting startup UI, app crash, live audio saving, R2 CORS, content-type mismatch) are all complete.

## Note on `transcribe` Edge Function

Per `DEPLOYMENT.md` line 86: **do not deploy** `transcribe`, `summarize`, `deepgram-proxy`, or `send-email`. The `transcribe` edge function is intentionally unused — all transcription and summarization runs client-side. The fix to `transcribe/index.ts` applied in a previous session was based on incorrect context; the file on disk is harmless since the function is never deployed.

---

## Immediate Bug Fix — Speaker Diarization / Transcript Display

**File:** `src/app/components/meeting-detail.tsx`

**Root Cause:** `chunksToUtterances()` returns `{ text, startTime, endTime }` but `TranscriptViewer` (and `MeetingMinutes`) expect `TranscriptUtterance` which has `{ transcript, start, end }`. Result: transcript text is `undefined` in the viewer (appears blank), karaoke doesn't highlight words, and active-utterance detection doesn't work — looks like diarization is broken even though speaker labels themselves are stored correctly.

**Fix:** Rename the three mismatched fields:

```typescript
function chunksToUtterances(chunks: ChunkRow[]) {
  return chunks.map(c => ({
    id: c.id,
    speaker: c.speaker ?? 'Unknown',
    transcript: c.text,                    // was: text
    start: c.timestamp_start ?? 0,         // was: startTime
    end: c.timestamp_end ?? 0,             // was: endTime
    isFinal: c.is_final,
    words: (c.words as { word: string; punctuated_word?: string; start: number; end: number; confidence: number }[] | null) ?? [],
  }));
}
```

This is the only change needed — no other files require modification for this bug.

---

## Context

MeetSummary already auto-captures transcripts, action items, decisions, and AI summaries. The missing piece for client-facing use is the **professional meeting workflow**: input an agenda before the meeting → AI uses it to structure the output → view and export formal meeting minutes as PDF.

Manual note-taking was considered and ruled out — the AI automation already covers it.

---

## What Gets Built

**1. Pre-meeting agenda input** — Add an agenda items field to the live setup form and upload page. These are passed to the AI summarization prompt so the output is structured around agenda topics rather than generic discussion points.

**2. Structured meeting minutes view** — A new `MeetingMinutes` component rendered as a "Minutes" tab in meeting detail. Looks like a real formal minutes document: header, attendees, agenda, discussion notes per agenda item, decisions, action items table, risks, footer.

**3. PDF export** — "Export PDF" opens a print-ready version of the minutes and calls `window.print()`. No new npm packages needed — browser Print → Save as PDF produces a clean, text-selectable PDF. Print CSS ensures the document looks like an A4 letter.

---

## Design Principles

- **Agenda is always optional** — zero required fields. Everything works without it.
- **Editable at any point** — setup form, post-meeting detail view. Not locked to pre-meeting.
- **Visible during live meeting** — read-only reference in the Copilot panel so the facilitator can track progress against topics.
- **Graceful absence** — minutes render fine with "No agenda recorded" when empty.

---

## Implementation Plan

### Step 1 — Database: Add `agenda_items` column

**File:** `supabase/schema.sql`

Add to the `meetings` table (after `tags TEXT[]`, matching its pattern):
```sql
agenda_items TEXT[] DEFAULT '{}',
```
Plus an idempotent migration block:
```sql
DO $$ BEGIN
  ALTER TABLE meetings ADD COLUMN IF NOT EXISTS agenda_items TEXT[] DEFAULT '{}';
END $$;
```

### Step 2 — TypeScript types

**File:** `src/lib/database.types.ts`

Add `agenda_items: string[] | null` to `Tables['meetings']['Row']`, `Insert`, and `Update`.

### Step 3 — Live setup form: Agenda input

**File:** `src/app/components/live-session-setup.tsx`

- Add `agendaItems?: string[]` to `LiveSettings` (line ~22) — also update `src/app/live-types.ts`
- Add optional "Agenda" section below the output mode selector:
  - Text input + "Add" button → appends to array
  - Renders numbered list; each item has a remove ×
  - Placeholder: "e.g. Q2 budget review"
- Pass `agendaItems` in settings to `onStart(source, settings)`

### Step 4 — Upload page: Agenda input + editable title

**File:** `src/app/components/upload-page.tsx`

- Add an editable `title` input pre-filled from filename (currently auto-generated, never editable)
- Add same agenda items UI as Step 3
- Pass both via extended `PipelineOptions`

### Step 5 — AI prompt: Thread agenda through upload pipeline

**File:** `src/lib/upload-pipeline.ts`

- Add `agendaItems?: string[]` to `PipelineOptions`
- In `generateSummary()`, inject agenda into system prompt when present:
  ```
  Agenda (structure your summary around these topics in order):
  1. Q2 budget review
  2. Product roadmap
  ...
  ```
- Pass `agendaItems` to `savePipelineResult()` → insert into `meetings.agenda_items`

**File:** `src/services/meetings.ts` — add `agendaItems?: string[]` to `savePipelineResult` params, include in INSERT.

### Step 6 — Live session: Thread agenda through

**File:** `src/services/live-session.ts`

- `createLiveSession(source, settings, agendaItems?)` — include `agenda_items` in meetings INSERT
- Also store in `live_sessions.settings` JSONB for reference

**File:** `src/app/components/live-meeting-page.tsx`

- Hold agenda in state, seeded from `startSession()` call
- Pass to `triggerLLMSummary()` → include in OpenRouter prompt (same injection as Step 5)

### Step 7 — Agenda visible during live meeting

**File:** `src/app/components/live-copilot-panel.tsx`

- Add `agendaItems?: string[]` to `LiveCopilotPanelProps`
- Add `'agenda'` to the `CopilotTab` type (line 33)
- Add "Agenda" tab button in the tab bar (after risks, before chat)
- Tab content: read-only numbered list of agenda items; if empty, show "No agenda — add one after the meeting"
- No interaction — just a reference view while facilitating

**File:** `src/app/components/live-meeting-page.tsx` — pass `agendaItems` down to both mobile and desktop `<LiveCopilotPanel>`.

### Step 8 — Agenda editable post-meeting

**File:** `src/app/components/meeting-detail.tsx`

- Add `agendaItems` state, initialised from `meeting.agenda_items`
- Add a small inline "Agenda" edit section above `<AISummaryPanel>` in the right panel (before line 477):
  - Collapsed by default if agenda exists, showing items as read-only chips
  - "Edit" pencil icon expands to the same add/remove list UI from Step 3
  - On save: `supabase.from('meetings').update({ agenda_items: agendaItems }).eq('id', meetingId)`
  - If agenda is empty: shows "Add agenda" link in muted text

### Step 9 — MeetingMinutes component (NEW)

**File:** `src/app/components/meeting-minutes.tsx`

Pure display component. Props: `meeting`, `summary`, `actionItems`, `chunks`, `speakerMap`, `agendaItems`.

Sections in order:
1. **Header** — title (large), date, duration, source/platform
2. **Attendees** — `overview.participants` as comma-separated list
3. **Agenda** — numbered list from `agendaItems`; "No agenda recorded" if empty
4. **Key Discussion** — `keyDiscussionPoints` as bullets (AI already structures around agenda if provided)
5. **Decisions Made** — numbered list from `keyDecisions`
6. **Action Items** — `<table>`: Task | Owner | Due Date | Status
7. **Risks / Open Issues** — bullets from `risks`
8. **Full Transcript** — `[MM:SS] Speaker: text` per utterance (reuses existing chunk format)
9. **Footer** — "Generated by MeetSummary · AI-assisted, human-reviewed"

**`@media print` CSS** (injected via `<style>` tag inside the component):
- A4 margins, serif font 11pt
- Section headings: uppercase, border-bottom, page-break-after: avoid
- Action items table: full-width, cell borders
- `body > *:not([data-minutes-root])` → `display: none` (hides the rest of the app during print)
- Page breaks avoided inside tables and lists

### Step 10 — Meeting detail: Minutes tab + PDF button

**File:** `src/app/components/meeting-detail.tsx`

- Add a `detailView: 'summary' | 'minutes'` state
- Add "Summary" / "Minutes" toggle buttons in the right panel header (above AISummaryPanel)
- When `detailView === 'minutes'`: render `<MeetingMinutes>` instead of `<AISummaryPanel>`
- In the Minutes view, show an "Export PDF" button:
  ```typescript
  const exportPDF = () => {
    const prev = document.title;
    document.title = `${meeting.title} — Minutes`;
    window.print();
    document.title = prev;
  };
  ```
- Also add "Export PDF" alongside the existing Export button in the action bar

---

## Files Modified / Created

| File | Change |
|------|--------|
| `supabase/schema.sql` | Add `agenda_items TEXT[]` to meetings |
| `src/lib/database.types.ts` | Add `agenda_items` to meetings Row/Insert/Update |
| `src/app/live-types.ts` | Add `agendaItems?: string[]` to `LiveSettings` |
| `src/app/components/live-session-setup.tsx` | Optional agenda list UI |
| `src/app/components/upload-page.tsx` | Editable title + agenda list UI |
| `src/lib/upload-pipeline.ts` | Inject agenda into AI prompt; pass to savePipelineResult |
| `src/services/meetings.ts` | `agenda_items` in savePipelineResult INSERT |
| `src/services/live-session.ts` | `agenda_items` in createLiveSession INSERT |
| `src/app/components/live-meeting-page.tsx` | Agenda state; pass to copilot panel; inject into summary prompt |
| `src/app/components/live-copilot-panel.tsx` | New "Agenda" tab (read-only reference) |
| `src/app/components/meeting-detail.tsx` | Inline agenda editor; Summary/Minutes toggle; Export PDF |
| `src/app/components/meeting-minutes.tsx` | **NEW** — formal minutes document with print CSS |

No new npm packages required.

---

## Verification

1. **Live meeting with agenda** — Setup form → add 3 agenda items → Start → see Agenda tab in copilot panel → End meeting → meeting detail shows agenda chips + Minutes tab → AI discussion is structured around the agenda topics → Export PDF → clean A4 document
2. **Live meeting without agenda** — Start with no agenda → everything still works → Minutes tab shows "No agenda recorded" → can add agenda post-meeting via Edit link
3. **Upload with agenda** — Upload page → enter title + agenda → upload → minutes view shows agenda
4. **Post-meeting agenda edit** — Open any meeting → Edit agenda → add items → save → Minutes view updates immediately

---

# Feature Gap Analysis (Reference)



---

## What's Already Built

| Feature | Status |
|---------|--------|
| Live transcription (Deepgram WebSocket) | ✅ |
| Speaker detection + post-meeting ID mapping | ✅ |
| AI Copilot (action items, decisions, risks, coaching) | ✅ |
| Running summary every 5 min during live meeting | ✅ |
| Live chat with AI about transcript | ✅ |
| Sentiment analysis per utterance | ✅ |
| Live translation | ✅ |
| Manual "mark important moment" button | ✅ |
| Post-meeting full transcript viewer + audio karaoke | ✅ |
| AI summary (short + client mode) | ✅ |
| Action items with owner/due date/status | ✅ |
| Export hub (text, CSV, calendar, Notion, ClickUp, Sheets, HubSpot, Salesforce, Slack, Teams) | ✅ |
| Follow-up email draft | ✅ |
| Analytics page (volume, speaker time, sentiment trends) | ✅ |
| Team / org management | ✅ |
| PII redaction / compliance mode | ✅ |
| Audit log | ✅ |

---

## Identified Gaps (Priority Order)

### 1. Manual Notes During Live Meeting ❌ MISSING
**Impact: High.** During a client meeting, the AI copilot auto-captures action items and decisions, but there is no freeform text field for the host to jot their own notes. A facilitator often needs to capture something that the AI won't auto-detect — a side comment, a personal reminder, a quick follow-up thought.

**What's needed:**
- A "Notes" tab or side input inside the live meeting page (alongside Transcript and Copilot tabs)
- Free-form text area that auto-saves to a `notes` field on the `live_sessions` or `meetings` table
- Notes persisted and surfaced in the meeting detail page alongside the AI summary

### 2. Formal Meeting Minutes Output ❌ MISSING
**Impact: High for client-facing use.** The AI summary exists but it doesn't look like "meeting minutes" — the structured document that gets circulated after a formal meeting. Meeting minutes have a specific shape:
- **Header**: Date, attendees, meeting title, location/platform
- **Agenda Items** (structured numbered list)
- **Discussion Notes** (per agenda item)
- **Decisions Made** (numbered list)
- **Action Items** (table: task | owner | due date)
- **Next Meeting** date/agenda
- **Signed off by** (facilitator name)

This should be exportable as PDF (currently there's no PDF export at all).

### 3. No PDF Export ❌ MISSING
**Impact: High.** The export hub covers text, CSV, calendar, and 8 integration targets but no PDF. Clients and managers expect meeting minutes and summaries delivered as PDFs. Implementable via `jsPDF` or `react-pdf` client-side.

### 4. Transcript Annotation / Highlighting ❌ MISSING
**Impact: Medium.** Users can't highlight a phrase in the transcript and attach a comment or tag. This is useful for legal/compliance review or when preparing a debrief. Would require a new `annotations` table and UI overlay on the transcript.

### 5. Edit AI Summary After Generation ❌ MISSING
**Impact: Medium.** Once the final AI summary is generated, users can't correct it. If the AI misidentifies a decision or action item, there's no fix path. This is a common pain point for AI-generated content.

### 6. Agenda Input Before Meeting ❌ MISSING
**Impact: Medium.** A facilitator usually has an agenda before the meeting starts. The app has no way to input agenda items up front. This could feed into the AI prompt to generate better, agenda-structured summaries and minutes.

### 7. No Video/Bot Integration (Zoom, Meet, Teams) ⚠️ PARTIAL
**Impact: Medium-High.** The `source` field supports `zoom | meet | teams` but there's no actual Zoom/Meet/Teams bot or API integration. The user must manually record and upload, or use the browser mic. Native bot integration (auto-join, auto-record) would be a significant differentiator.

---

## Recommended Next Implementation

**Option A — Notes + Minutes (highest user value, moderate effort)**
Add a live notes panel, persist notes to the meetings table, and build a formal meeting minutes view/PDF export. This directly addresses the user's question and closes the biggest gap for client-facing use.

**Option B — PDF Export only (quick win)**
Add PDF export of the existing AI summary. Fastest to implement, uses existing data.

**Option C — Transcript Annotation (polish)**
Add highlight + comment overlay on transcript viewer. Enhances the post-meeting review experience.

---

# Bug 1 — Deepgram 408 Upload Timeout

**File:** `src/lib/deepgram-rest.ts`

**Cause:** `transcribeWithDeepgram()` does a single `fetch()` with no retry. Deepgram's server returns 408 when the audio upload takes too long over a slow connection.

**Fix:** Wrap the fetch in a retry loop — up to 2 retries on 408, with a 1.5 s delay between attempts.

```ts
// replace the single fetch call with:
const MAX_RETRIES = 2;
let res: Response | undefined;
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  res = await fetch(DG_REST_URL, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'audio/raw' },
    body: pcm,
  });
  if (res.status !== 408 || attempt === MAX_RETRIES) break;
  await new Promise(r => setTimeout(r, 1500));
}
```

Everything after the fetch (status check, JSON parse) stays unchanged.

---

## Bug 2 — Live Meeting Startup Steps UI

**File:** `src/app/components/live-meeting-page.tsx`

**Cause:** The `phase === 'connecting'` block (lines 437–457) renders a subtitle and a list of 4 internal step items below "Starting session…".

**Fix:** Delete two elements inside that block:
- Line 445: `<p className="...">Setting up Deepgram · Supabase · AI Copilot</p>` — remove
- Lines 447–454: the `<div className="flex flex-col gap-2.5 w-72">` steps list — remove entirely

Result: the connecting screen shows only the spinner and "Starting session…" heading.

---

## Bug 3 — App Failed to Render (two root causes)

### 3a — `setSendResult` reference error in EmailDraftModal

**File:** `src/app/components/email-draft-modal.tsx`, line 32

**Cause:** When we removed the Resend integration, we deleted the `setSendResult` state declaration but left the call `setSendResult(null)` inside `generateDraft()`. At runtime this is a `ReferenceError`. Because it's thrown *before* the try block, it becomes an unhandled rejection that propagates through the `useEffect` chain and crashes the component tree, caught by `AppErrorBoundary`.

**Fix:** Delete line 32: `setSendResult(null);`

### 3b — Sparkline crash on empty data

**File:** `src/app/components/dashboard-page.tsx`, `Sparkline` component, lines 46 and 53

**Cause:** If `data` is an empty array, `data.length - 1 = -1` making `step` negative, and `pts` becomes `[]`. Line 53 then accesses `pts[pts.length-1]` which is `pts[-1]` = `undefined`, throwing `Cannot read properties of undefined (reading 'x')` — caught by the error boundary as "App failed to render".

Currently `weeklyData` is initialised to 7 entries, but any code path that passes fewer than 2 points triggers this.

**Fix:** Add a guard at the top of `Sparkline`:
```tsx
function Sparkline({ data }: { data: { day: string; meetings: number }[] }) {
  if (!data || data.length < 2) return null;   // ← add this line
  // … rest unchanged
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/deepgram-rest.ts` | Retry loop (up to 2 retries, 1.5 s) on 408 |
| `src/app/components/live-meeting-page.tsx` | Remove subtitle + steps list from connecting phase |
| `src/app/components/email-draft-modal.tsx` | Remove orphaned `setSendResult(null)` call |
| `src/app/components/dashboard-page.tsx` | Guard `Sparkline` against empty/single-point data |

---

## Verification

1. Upload a large (50+ MB) file — should complete without 408; if a retry occurs it should be transparent
2. Start a live meeting — connecting screen shows only spinner + "Starting session…", no step list
3. Open any meeting and click **Email** — modal opens, draft generates without "App failed to render"
4. Load the dashboard with zero meetings — sparkline renders nothing rather than crashing

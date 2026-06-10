/**
 * Export integrations: CSV, Notion API v1, ClickUp API v2, Google Sheets via Apps Script.
 * User-facing credentials stored in localStorage (export integrations are browser-side by nature).
 * Backend API keys (Deepgram, OpenRouter) live in Supabase Edge Function secrets — never here.
 */

export interface ExportActionItem {
  task: string;
  owner?: string | null;
  dueDate?: string | null;
  status: string;
}

// ─── localStorage helpers ────────────────────────────────────────────────────
const KEY = {
  NOTION_TOKEN:         'ms_notion_token',
  NOTION_DB_ID:         'ms_notion_db_id',
  CLICKUP_TOKEN:        'ms_clickup_token',
  CLICKUP_LIST_ID:      'ms_clickup_list_id',
  GOOGLE_SHEETS_ID:     'ms_google_sheets_id',
  DEEPGRAM_API_KEY:     'ms_deepgram_api_key',
  OPENROUTER_API_KEY:   'ms_openrouter_api_key',
  HUBSPOT_API_KEY:             'ms_hubspot_api_key',
  TRANSLATION_LANGUAGE:        'ms_translation_language',
  SALESFORCE_INSTANCE_URL:     'ms_salesforce_instance_url',
  SALESFORCE_CLIENT_ID:        'ms_salesforce_client_id',
  SALESFORCE_CLIENT_SECRET:    'ms_salesforce_client_secret',
  SALESFORCE_USERNAME:         'ms_salesforce_username',
  SALESFORCE_PASSWORD:         'ms_salesforce_password',
  SALESFORCE_TOKEN:            'ms_salesforce_token',
  SLACK_WEBHOOK_URL:           'ms_slack_webhook_url',
  TEAMS_WEBHOOK_URL:           'ms_teams_webhook_url',
} as const;

export function getSetting(key: keyof typeof KEY): string {
  try { return localStorage.getItem(KEY[key]) ?? ''; } catch { return ''; }
}
export function setSetting(key: keyof typeof KEY, value: string): void {
  try { localStorage.setItem(KEY[key], value); } catch { /* storage unavailable */ }
}

// ─── Security helpers ────────────────────────────────────────────────────────

/** Prevent spreadsheet formula injection (=, +, @, -, tab, CR). */
function csvCell(s: string): string {
  const v = String(s ?? '').replace(/"/g, '""');
  return /^[=+\-@\t\r]/.test(v) ? `"\t${v}"` : `"${v}"`;
}

/** Only allow safe HTTPS URLs — blocks localhost and RFC-1918 ranges. */
function isSafeHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return true;
  } catch { return false; }
}

/** Notion database ID: 32 hex chars, optionally with dashes. */
function isValidNotionDbId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id.replace(/-/g, '').toLowerCase());
}

/** ClickUp list ID must be numeric. */
function isValidClickUpListId(id: string): boolean {
  return /^\d+$/.test(id.trim());
}

// ─── CSV ─────────────────────────────────────────────────────────────────────
export function exportToCSV(items: ExportActionItem[], meetingTitle: string): void {
  const header = 'Task,Owner,Due Date,Status';
  const rows = items.map(i => [
    csvCell(i.task),
    csvCell(i.owner ?? ''),
    csvCell(i.dueDate ?? ''),
    i.status,
  ].join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${meetingTitle.replace(/[^a-z0-9]/gi, '_')}_action_items.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Notion ──────────────────────────────────────────────────────────────────
export async function exportToNotion(
  items: ExportActionItem[],
  meetingTitle: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = getSetting('NOTION_TOKEN');
  const dbId  = getSetting('NOTION_DB_ID').replace(/\s/g, '');

  if (!token)                      return { ok: false, error: 'Notion integration token not configured in Settings' };
  if (!isValidNotionDbId(dbId))    return { ok: false, error: 'Invalid Notion database ID — must be 32 hex characters' };

  const results = await Promise.all(items.map(item =>
    fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          Name:      { title:     [{ text: { content: item.task.slice(0, 2000) } }] },
          Owner:     { rich_text: [{ text: { content: (item.owner ?? '').slice(0, 200) } }] },
          'Due Date':{ rich_text: [{ text: { content: (item.dueDate ?? '').slice(0, 50) } }] },
          Status:    { select:    { name: item.status } },
          Meeting:   { rich_text: [{ text: { content: meetingTitle.slice(0, 500) } }] },
        },
      }),
    }).then(r => r.ok).catch(() => false),
  ));

  const failed = results.filter(ok => !ok).length;
  return failed > 0
    ? { ok: false, error: `${failed}/${items.length} items failed to create in Notion` }
    : { ok: true };
}

// ─── ClickUp ─────────────────────────────────────────────────────────────────
export async function exportToClickUp(
  items: ExportActionItem[],
  meetingTitle: string,
): Promise<{ ok: boolean; error?: string }> {
  const token  = getSetting('CLICKUP_TOKEN');
  const listId = getSetting('CLICKUP_LIST_ID').trim();

  if (!token)                         return { ok: false, error: 'ClickUp API token not configured in Settings' };
  if (!isValidClickUpListId(listId))  return { ok: false, error: 'Invalid ClickUp List ID — must be a numeric ID' };

  const statusMap: Record<string, string> = { pending: 'Open', in_progress: 'In Progress', complete: 'Closed' };

  const results = await Promise.all(items.map(item =>
    fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: item.task.slice(0, 500),
        description: `From meeting: ${meetingTitle}${item.owner ? `\nOwner: ${item.owner}` : ''}`.slice(0, 2000),
        status: statusMap[item.status] ?? 'Open',
        due_date: item.dueDate ? new Date(item.dueDate).getTime() : undefined,
        assignees: [],
        tags: ['meetsummary'],
      }),
    }).then(r => r.ok).catch(() => false),
  ));

  const failed = results.filter(ok => !ok).length;
  return failed > 0
    ? { ok: false, error: `${failed}/${items.length} items failed to create in ClickUp` }
    : { ok: true };
}

// ─── HubSpot CRM (Private App Token) ─────────────────────────────────────────
export async function exportToHubSpot(
  items: ExportActionItem[],
  meetingTitle: string,
  contactEmail?: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = getSetting('HUBSPOT_API_KEY').trim();
  if (!token) return { ok: false, error: 'HubSpot Private App Token not configured in Settings' };

  const noteBody = [
    `Meeting: ${meetingTitle}`,
    '',
    'Action Items:',
    ...items.map(i => `• ${i.task}${i.owner ? ` (${i.owner})` : ''}${i.dueDate ? ` — Due ${i.dueDate}` : ''}`),
  ].join('\n');

  try {
    // Create a note object
    const noteRes = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          hs_note_body: noteBody.slice(0, 65535),
          hs_timestamp: new Date().toISOString(),
        },
      }),
    });

    if (noteRes.status === 401 || noteRes.status === 403) {
      return { ok: false, error: 'HubSpot authentication failed — check your Private App Token in Settings' };
    }
    if (!noteRes.ok) {
      const body = await noteRes.json().catch(() => ({})) as { message?: string };
      return { ok: false, error: body?.message ?? `HubSpot error: HTTP ${noteRes.status}` };
    }

    const noteData = await noteRes.json() as { id?: string };
    const noteId = noteData.id;

    // If contact email provided, find the contact and associate
    if (noteId && contactEmail) {
      const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: contactEmail }] }],
          properties: ['email'],
          limit: 1,
        }),
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json() as { results?: { id: string }[] };
        const contactId = searchData.results?.[0]?.id;
        if (contactId) {
          await fetch(`https://api.hubapi.com/crm/v3/objects/notes/${noteId}/associations/contact/${contactId}/202`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'HubSpot request failed' };
  }
}

// ─── iCalendar (.ics) ─────────────────────────────────────────────────────────
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function exportToICS(items: ExportActionItem[], meetingTitle: string, meetingDateISO?: string): void {
  const now = new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MeetSummary//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const item of items) {
    const uid = `meetsummary-${Date.now()}-${Math.random().toString(36).slice(2)}@meetsummary`;
    let dtStart: Date;
    let dtEnd: Date;

    if (item.dueDate) {
      try {
        dtStart = new Date(item.dueDate);
        dtStart.setHours(9, 0, 0, 0);
        dtEnd = new Date(dtStart.getTime() + 60 * 60 * 1000);
      } catch {
        dtStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        dtEnd = new Date(dtStart.getTime() + 60 * 60 * 1000);
      }
    } else {
      dtStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      dtEnd = new Date(dtStart.getTime() + 60 * 60 * 1000);
    }

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${toICSDate(now)}`,
      `DTSTART:${toICSDate(dtStart)}`,
      `DTEND:${toICSDate(dtEnd)}`,
      `SUMMARY:${icsEscape(item.task.slice(0, 255))}`,
      `DESCRIPTION:${icsEscape(`From meeting: ${meetingTitle}${item.owner ? `\nOwner: ${item.owner}` : ''}\nStatus: ${item.status}`)}`,
      item.owner ? `ORGANIZER;CN=${icsEscape(item.owner)}:MAILTO:unknown@meetsummary.app` : '',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  const ics = lines.filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${meetingTitle.replace(/[^a-z0-9]/gi, '_')}_action_items.ics`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── OneNote HTML export ──────────────────────────────────────────────────────
export function exportToOneNoteHTML(
  meetingTitle: string,
  date: string,
  summary: { keyPoints?: string[]; decisions?: string[]; risks?: string[] } | null,
  items: ExportActionItem[],
  transcript?: string,
): void {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const listItems = (arr: string[]) => arr.map(s => `<li>${escape(s)}</li>`).join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${escape(meetingTitle)}</title>
<style>
  body { font-family: Segoe UI, sans-serif; max-width: 800px; margin: 40px auto; color: #333; }
  h1 { color: #1a1a2e; } h2 { color: #16213e; border-bottom: 1px solid #eee; padding-bottom: 6px; }
  li { margin: 4px 0; } .meta { color: #888; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #f4f4f4; } pre { background: #f9f9f9; padding: 16px; border-radius: 6px; white-space: pre-wrap; font-size: 13px; }
</style></head>
<body>
<h1>${escape(meetingTitle)}</h1>
<p class="meta">Date: ${escape(date)}</p>
${summary?.keyPoints?.length ? `<h2>Key Discussion Points</h2><ul>${listItems(summary.keyPoints)}</ul>` : ''}
${summary?.decisions?.length ? `<h2>Key Decisions</h2><ul>${listItems(summary.decisions)}</ul>` : ''}
${summary?.risks?.length ? `<h2>Risks</h2><ul>${listItems(summary.risks)}</ul>` : ''}
${items.length > 0 ? `
<h2>Action Items</h2>
<table>
  <tr><th>Task</th><th>Owner</th><th>Due Date</th><th>Status</th></tr>
  ${items.map(i => `<tr><td>${escape(i.task)}</td><td>${escape(i.owner ?? '')}</td><td>${escape(i.dueDate ?? '')}</td><td>${escape(i.status)}</td></tr>`).join('\n')}
</table>` : ''}
${transcript ? `<h2>Transcript</h2><pre>${escape(transcript)}</pre>` : ''}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${meetingTitle.replace(/[^a-z0-9]/gi, '_')}_meetsummary.html`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Google Sheets (Apps Script Web App) ─────────────────────────────────────
export async function exportToGoogleSheets(
  items: ExportActionItem[],
  meetingTitle: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = getSetting('GOOGLE_SHEETS_ID').trim();

  // No URL configured → fall back to CSV download
  if (!url) { exportToCSV(items, meetingTitle); return { ok: true }; }

  if (!isSafeHttpsUrl(url)) {
    return { ok: false, error: 'Apps Script URL must be a valid HTTPS address (script.google.com)' };
  }

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors', // Apps Script requires no-cors
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingTitle, items }),
    });
    return { ok: true };
  } catch {
    exportToCSV(items, meetingTitle); // silent fallback to CSV
    return { ok: true };
  }
}

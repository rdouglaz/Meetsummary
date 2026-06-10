/**
 * OpenRouter client with sequential model fallback and persistent error logging.
 * All call sites (Ask AI, upload pipeline, live summary) use callOpenRouter().
 * Errors are stored in localStorage and surfaced in Settings → AI Services → Error Log.
 */

import { llmModels } from '../app/components/settings-page';

// ─── Error log ─────────────────────────────────────────────────────────────────

const LOG_KEY = 'ms_ai_error_log';
const MAX_LOG = 100;

export interface AIErrorEntry {
  ts:       number;   // ms epoch
  context:  string;   // 'ask-ai' | 'upload-summary' | 'live-summary'
  model:    string;   // model id that was tried
  status?:  number;   // HTTP status code if applicable
  error:    string;   // human-readable error
}

export function logAIError(entry: Omit<AIErrorEntry, 'ts'>): void {
  try {
    const log = getAIErrorLog();
    log.unshift({ ...entry, ts: Date.now() });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, MAX_LOG)));
  } catch { /* storage unavailable */ }
}

export function getAIErrorLog(): AIErrorEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as AIErrorEntry[]) : [];
  } catch { return []; }
}

export function clearAIErrorLog(): void {
  try { localStorage.removeItem(LOG_KEY); } catch { /* */ }
}

// ─── Smart routing with sequential fallback ────────────────────────────────────

/**
 * Attempts each model in llmModels order until one succeeds.
 * Logs every failure. Throws only after all models are exhausted (or auth fails).
 *
 * @param apiKey  OpenRouter key from Settings
 * @param messages  Standard OpenAI-compatible messages array
 * @param context  Label for the error log ('ask-ai', 'upload-summary', 'live-summary')
 * @returns  The model's text content
 */
export async function callOpenRouter(
  apiKey:   string,
  messages: { role: string; content: string }[],
  context:  string,
): Promise<string> {
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured. Go to Settings → AI Services to add your key.');
  }

  let lastError = 'All models failed';

  for (const { id: model } of llmModels) {
    let status: number | undefined;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title':      'MeetSummary',
        },
        body: JSON.stringify({ model, messages }),
      });

      status = res.status;

      // Auth failures are terminal — no point trying next model
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        const errMsg = body?.error?.message ?? `HTTP ${res.status} Unauthorized`;
        logAIError({ context, model, status: res.status, error: errMsg });
        throw new Error(`OpenRouter authentication failed: ${errMsg}`);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        const errMsg = body?.error?.message ?? `HTTP ${res.status}`;
        logAIError({ context, model, status: res.status, error: errMsg });
        lastError = errMsg;
        continue; // try next model
      }

      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const content = data?.choices?.[0]?.message?.content;

      if (!content) {
        logAIError({ context, model, status, error: 'Empty response from model' });
        lastError = 'Empty response';
        continue; // try next model
      }

      return content; // success
    } catch (err) {
      // Re-throw auth errors immediately
      if (err instanceof Error && err.message.startsWith('OpenRouter authentication failed')) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      logAIError({ context, model, status, error: errMsg });
      lastError = errMsg;
    }
  }

  throw new Error(
    `All OpenRouter models failed (last error: ${lastError}). ` +
    `Check Settings → AI Services → Error Log for details.`,
  );
}

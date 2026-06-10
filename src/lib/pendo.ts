/**
 * Pendo (Novus) SDK — visitor and account tracking.
 *
 * Usage:
 *   loadPendo()     — call once on app mount; injects the CDN agent script.
 *   identifyPendo() — call on every auth state change (login, logout, org switch).
 *   trackEvent()    — call anywhere for custom event tracking.
 *
 * Required env var: VITE_PENDO_API_KEY
 */

declare global {
  interface Window {
    pendo?: {
      initialize: (opts: PendoOptions) => void;
      identify:   (opts: PendoOptions) => void;
      track:      (event: string, properties?: Record<string, unknown>) => void;
      isReady?:   () => boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _q?: any[];
    };
  }
}

interface PendoOptions {
  visitor: {
    id:         string;
    email?:     string;
    full_name?: string;
    createdAt?: string;
  };
  account?: {
    id:    string;
    name?: string;
  };
}

const API_KEY = (import.meta.env.VITE_PENDO_API_KEY as string | undefined) ?? '';

let snippetInjected = false;
let pendoInitialized = false;

/** Inject the Pendo agent script once. Safe to call multiple times. */
export function loadPendo(): void {
  if (snippetInjected || !API_KEY) return;
  snippetInjected = true;

  // Stub pendo globally so calls queued before the script loads are replayed.
  window.pendo = window.pendo ?? { _q: [] } as typeof window.pendo;
  const methods = ['initialize', 'identify', 'updateOptions', 'pageLoad', 'track'] as const;
  for (const m of methods) {
    if (!window.pendo![m]) {
      // @ts-expect-error — dynamic stub
      window.pendo![m] = (...args: unknown[]) => window.pendo!._q!.push([m, ...args]);
    }
  }

  const script = document.createElement('script');
  script.async = true;
  script.src   = `https://cdn.pendo.io/agent/static/${API_KEY}/pendo.js`;
  document.head.appendChild(script);
}

/**
 * Identify the current visitor and account.
 * Call this every time Supabase auth state changes.
 */
export function identifyPendo(opts: {
  userId?:    string | null;
  email?:     string | null;
  fullName?:  string | null;
  createdAt?: string | null;
  orgId?:     string | null;
  orgName?:   string | null;
}): void {
  if (!API_KEY) return;

  const visitor = {
    id:         opts.userId    ?? 'anonymous',
    email:      opts.email     ?? undefined,
    full_name:  opts.fullName  ?? undefined,
    createdAt:  opts.createdAt ?? undefined,
  };

  const account = opts.userId
    ? { id: opts.orgId ?? opts.userId, name: opts.orgName ?? undefined }
    : undefined;

  const payload: PendoOptions = { visitor, ...(account ? { account } : {}) };

  // Pendo requires initialize() once, then identify() for subsequent updates.
  if (!pendoInitialized) {
    pendoInitialized = true;
    window.pendo?.initialize(payload);
  } else {
    window.pendo?.identify(payload);
  }
}

/** Track a custom event. */
export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!API_KEY) return;
  window.pendo?.track(event, properties);
}

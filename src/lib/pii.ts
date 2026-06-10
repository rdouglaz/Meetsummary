export type PIIType = 'email' | 'phone' | 'ssn' | 'credit_card' | 'ip_address';

interface PIIPattern { type: PIIType; regex: RegExp; label: string }

const PATTERNS: PIIPattern[] = [
  { type: 'email',       label: '[EMAIL]',   regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: 'phone',       label: '[PHONE]',   regex: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { type: 'ssn',         label: '[SSN]',     regex: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g },
  { type: 'credit_card', label: '[CARD]',    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
  { type: 'ip_address',  label: '[IP]',      regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

export function redactPII(text: string): string {
  let result = text;
  for (const { regex, label } of PATTERNS) {
    const r = new RegExp(regex.source, regex.flags);
    result = result.replace(r, label);
  }
  return result;
}

export function hasPII(text: string): boolean {
  return PATTERNS.some(({ regex }) => {
    const r = new RegExp(regex.source, regex.flags);
    return r.test(text);
  });
}

export function isComplianceModeEnabled(): boolean {
  try { return localStorage.getItem('ms_compliance_mode') === 'true'; } catch { return false; }
}

export function setComplianceMode(enabled: boolean): void {
  try { localStorage.setItem('ms_compliance_mode', String(enabled)); } catch {}
}

export function applyCompliance(text: string): string {
  return isComplianceModeEnabled() ? redactPII(text) : text;
}

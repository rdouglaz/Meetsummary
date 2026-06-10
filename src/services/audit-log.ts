import { supabase } from '../lib/supabase';
import { isComplianceModeEnabled } from '../lib/pii';

export type AuditAction = 'view' | 'export' | 'delete' | 'share' | 'download' | 'send_email' | 'crm_sync' | 'notify' | 'edit';
export type AuditResource = 'meeting' | 'transcript' | 'summary' | 'action_item';

export async function logAudit(
  action: AuditAction,
  resource: AuditResource,
  resourceId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!isComplianceModeEnabled()) return;
  try {
    await supabase.from('audit_logs').insert({
      action,
      resource_type: resource,
      resource_id: resourceId ?? null,
      metadata: metadata ?? {},
    });
  } catch { /* non-fatal */ }
}

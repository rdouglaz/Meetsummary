import { useState, useEffect } from 'react';
import { X, Mail, Copy, ExternalLink, Loader2, Check, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { getSetting } from '../../lib/exports';
import { callOpenRouter } from '../../lib/openrouter';

interface EmailDraftModalProps {
  meetingTitle: string;
  meetingDate: string;
  participants: string[];
  keyPoints: string[];
  decisions: string[];
  actionItems: { task: string; owner?: string | null; dueDate?: string | null }[];
  onClose: () => void;
}

export function EmailDraftModal({
  meetingTitle, meetingDate, participants, keyPoints, decisions, actionItems, onClose,
}: EmailDraftModalProps) {
  const [subject, setSubject] = useState(`Follow-up: ${meetingTitle}`);
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState(participants.join(', '));
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateDraft = async () => {
    const apiKey = getSetting('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('OpenRouter API key not configured in Settings');
    setGenerating(true);

    const prompt = [
      `Write a professional follow-up email for a meeting titled "${meetingTitle}" held on ${meetingDate}.`,
      participants.length > 0 ? `Participants: ${participants.join(', ')}.` : '',
      keyPoints.length > 0 ? `Key discussion points:\n${keyPoints.map(p => `- ${p}`).join('\n')}` : '',
      decisions.length > 0 ? `Key decisions:\n${decisions.map(d => `- ${d}`).join('\n')}` : '',
      actionItems.length > 0 ? `Action items:\n${actionItems.map(ai => `- ${ai.task}${ai.owner ? ` (${ai.owner})` : ''}${ai.dueDate ? `, due ${ai.dueDate}` : ''}`).join('\n')}` : '',
      'Write only the email body — no subject line. Keep it concise, professional, and action-oriented. Use plain text with clear line breaks.',
    ].filter(Boolean).join('\n\n');

    try {
      const draft = await callOpenRouter(
        apiKey,
        [
          { role: 'system', content: 'You are a professional assistant that writes concise follow-up emails.' },
          { role: 'user', content: prompt },
        ],
        'email-draft',
      );
      setBody(draft.trim());
      // Pendo Track: email draft generated
      (window as any).pendo?.track('email_draft_generated', {
        meetingTitle: meetingTitle.slice(0, 100),
        hasParticipants: participants.length > 0,
        hasActionItems: actionItems.length > 0,
        hasDecisions: decisions.length > 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    generateDraft().catch(err => {
      setBody(`⚠️ Could not generate draft: ${err instanceof Error ? err.message : String(err)}`);
      setGenerating(false);
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => { throw new Error('Could not copy to clipboard'); });
  };

  const handleOpenMailto = () => {
    const to = recipients.split(',').map(e => e.trim()).filter(Boolean).join(',');
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
    // Pendo Track: email draft sent via mailto
    (window as any).pendo?.track('email_draft_sent', {
      meetingTitle: meetingTitle.slice(0, 100),
      recipientCount: to.split(',').filter(Boolean).length,
      hasCustomEdits: body !== '',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-[600px] bg-background rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-foreground">Draft Follow-up Email</h2>
            <p className="text-[11.5px] text-muted-foreground truncate">{meetingTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Recipients */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12.5px]">Recipients</Label>
            <Input
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
              className="h-9 bg-background text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground">Comma-separated email addresses</p>
          </div>

          {/* Subject */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12.5px]">Subject</Label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Follow-up: ..."
              className="h-9 bg-background text-[13px]"
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12.5px]">Email Body</Label>
              <button
                onClick={() => generateDraft().catch(err => {
                  setBody(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
                })}
                disabled={generating}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            </div>
            {generating ? (
              <div className="flex items-center justify-center gap-2 py-12 rounded-xl bg-muted/40 border border-border">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-[12.5px] text-muted-foreground">AI is drafting your email…</span>
              </div>
            ) : (
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={12}
                className="w-full px-3.5 py-3 rounded-xl bg-background border border-border text-[13px] text-foreground leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-all"
              />
            )}
          </div>

        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-border flex-shrink-0 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-9"
            onClick={handleCopy}
            disabled={generating || !body}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-9"
            onClick={handleOpenMailto}
            disabled={generating || !body}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Mail App
          </Button>
        </div>
      </div>
    </div>
  );
}

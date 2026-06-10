import { useState } from 'react';
import { Calendar, Users, Target, CheckCircle2, AlertTriangle, Mail, ListChecks, Copy, Check, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { MeetingSummary, ActionItemStatus } from '../types';

function buildSummaryText(summary: MeetingSummary, mode: 'short' | 'client'): string {
  const lines: string[] = [];

  lines.push('MEETING OVERVIEW');
  lines.push(`Date & Duration: ${summary.overview.date} · ${summary.overview.duration}`);
  lines.push(`Participants: ${summary.overview.participants.join(', ')}`);
  lines.push(`Purpose: ${summary.overview.mainPurpose}`);

  if (mode === 'client' && summary.keyDiscussionPoints.length > 0) {
    lines.push('');
    lines.push('KEY DISCUSSION POINTS');
    summary.keyDiscussionPoints.forEach(p => lines.push(`• ${p}`));
  }

  if (summary.keyDecisions.length > 0) {
    lines.push('');
    lines.push('KEY DECISIONS MADE');
    summary.keyDecisions.forEach(d => lines.push(`• ${d}`));
  }

  if (summary.actionItems.length > 0) {
    lines.push('');
    lines.push('ACTION ITEMS');
    summary.actionItems.forEach(item =>
      lines.push(`• [${item.owner}] ${item.task} — due ${item.dueDate} (${item.status})`),
    );
  }

  if (summary.followUpEmail) {
    lines.push('');
    lines.push('FOLLOW-UP EMAIL DRAFT');
    lines.push(summary.followUpEmail);
  }

  if (summary.risks.length > 0) {
    lines.push('');
    lines.push('POTENTIAL RISKS / OPEN ISSUES');
    summary.risks.forEach(r => lines.push(`• ${r}`));
  }

  return lines.join('\n');
}

interface AISummaryPanelProps {
  summary: MeetingSummary;
  mode: 'short' | 'client';
  onModeChange: (mode: 'short' | 'client') => void;
}

const statusColors: Record<ActionItemStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  in_progress: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  complete: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};
const statusLabels: Record<ActionItemStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  complete: 'Done',
};

function SectionHeader({ icon: Icon, title, color }: { icon: React.ElementType; title: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className={`w-4 h-4 ${color}`} />
      <span className="text-[13px] font-semibold text-foreground">{title}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function AISummaryPanel({ summary, mode, onModeChange }: AISummaryPanelProps) {
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(buildSummaryText(summary, mode)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // Pendo Track: summary copied
      (window as any).pendo?.track('summary_copied', { summaryMode: mode });
    });
  };

  const handleExport = () => {
    const text = buildSummaryText(summary, mode);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Meeting Summary</title><style>
      body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#111;line-height:1.7;font-size:13px}
      h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin:1.5em 0 .4em}
      p,li{margin:.2em 0}ul{padding-left:1.2em}
    </style></head><body><pre style="white-space:pre-wrap;font-family:inherit">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`);
    win.document.close();
    win.focus();
    win.print();
    // Pendo Track: summary exported as HTML
    (window as any).pendo?.track('summary_exported_html', { summaryMode: mode });
  };

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1">
      {/* Mode toggle + export actions */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground">AI Summary</span>
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
            {(['short', 'client'] as const).map(m => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold capitalize transition-all ${
                  mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'short' ? 'Short' : 'Client'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="flex-1 gap-1.5 h-8 text-[12px]" onClick={handleCopyAll}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Summary'}
          </Button>
          <Button size="sm" variant="outline" className="flex-1 gap-1.5 h-8 text-[12px]" onClick={handleExport}>
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* 1. Meeting Overview */}
      <div className="bg-card border border-border rounded-xl p-4">
        <SectionHeader icon={Calendar} title="1. Meeting Overview" color="text-blue-500" />
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-start gap-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-[10px] text-muted-foreground">Date & Duration</div>
              <div className="text-[12px] text-foreground">{summary.overview.date} · {summary.overview.duration}</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Users className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-[10px] text-muted-foreground">Participants</div>
              <div className="text-[12px] text-foreground">{summary.overview.participants.length} attendees</div>
            </div>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-border">
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Target className="w-3 h-3" /> Main Purpose
          </div>
          <p className="text-[12px] text-foreground leading-relaxed">{summary.overview.mainPurpose}</p>
        </div>
        <div className="mt-2 pt-2 border-t border-border">
          <div className="text-[10px] text-muted-foreground mb-1.5">Participants</div>
          <div className="flex flex-col gap-1">
            {summary.overview.participants.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-bold text-primary-foreground">{p.charAt(0)}</span>
                </div>
                <span className="text-[12px] text-foreground">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Key Discussion Points */}
      {(mode === 'client' || !mode) && (
        <div className="bg-card border border-border rounded-xl p-4">
          <SectionHeader icon={ListChecks} title="2. Key Discussion Points" color="text-indigo-500" />
          <ul className="flex flex-col gap-1.5">
            {summary.keyDiscussionPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                <span className="text-[12px] text-foreground leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Key Decisions */}
      <div className="bg-card border border-border rounded-xl p-4">
        <SectionHeader icon={CheckCircle2} title="3. Key Decisions Made" color="text-emerald-500" />
        <ul className="flex flex-col gap-1.5">
          {summary.keyDecisions.map((decision, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <span className="text-[12px] text-foreground leading-relaxed">{decision}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 4. Action Items */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <SectionHeader icon={ListChecks} title="4. Action Items" color="text-purple-500" />
          <span className="text-[11px] text-muted-foreground">{summary.actionItems.length} tasks</span>
        </div>
        <div className="flex flex-col gap-2">
          {summary.actionItems.map(item => (
            <div key={item.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-accent/40">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-primary">[{item.owner}]</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColors[item.status]}`}>
                    {statusLabels[item.status]}
                  </span>
                </div>
                <p className="text-[12px] text-foreground leading-snug mt-0.5">{item.task}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Due: {item.dueDate}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Follow-up Email */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <SectionHeader icon={Mail} title="5. Follow-up Email Draft" color="text-sky-500" />
          <div className="flex items-center gap-2">
            <CopyButton text={summary.followUpEmail} />
            <button
              onClick={() => setEmailExpanded(v => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {emailExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className={`overflow-hidden transition-all ${emailExpanded ? 'max-h-[600px]' : 'max-h-[100px]'}`}>
          <pre className="text-[12px] text-foreground font-sans leading-relaxed whitespace-pre-wrap">
            {summary.followUpEmail}
          </pre>
        </div>
        {!emailExpanded && (
          <div className="mt-1 relative">
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent" />
          </div>
        )}
        {!emailExpanded && (
          <button
            onClick={() => setEmailExpanded(true)}
            className="text-[12px] text-primary underline underline-offset-2 mt-1 hover:text-primary/80 transition-colors"
          >
            Show full email
          </button>
        )}
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-[12px]"
            onClick={() => {
              const subject = encodeURIComponent('Follow-up from our meeting');
              const body = encodeURIComponent(summary.followUpEmail);
              window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, '_blank');
            }}
          >
            <Mail className="w-3.5 h-3.5" />
            Send via Gmail
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-[12px]"
            onClick={() => {
              const win = window.open('', '_blank');
              if (!win) return;
              win.document.write(`<!DOCTYPE html><html><head><title>Follow-up Email</title><style>
                body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 24px;color:#111;line-height:1.7}
                pre{white-space:pre-wrap;font-family:inherit}
              </style></head><body><pre>${summary.followUpEmail.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`);
              win.document.close();
              win.focus();
              win.print();
            }}
          >
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* 6. Risks */}
      {summary.risks.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <SectionHeader icon={AlertTriangle} title="6. Potential Risks / Open Issues" color="text-amber-500" />
          <ul className="flex flex-col gap-1.5">
            {summary.risks.map((risk, i) => (
              <li key={i} className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                <span className="text-[12px] text-foreground leading-relaxed">{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

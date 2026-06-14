import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, Share2, Download, FileText, Sparkles, Tag, Loader2, AlertCircle,
  MoreHorizontal, X, CheckCircle2, Globe, Calendar, BookOpen, FileSpreadsheet,
  SquareCheck, Mail, MessageSquare, Users, History, ShieldAlert,
  ListOrdered, Plus, FileOutput, Pencil, Check,
} from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Skeleton } from './ui/skeleton';
import { AudioPlayer } from './audio-player';
import { TranscriptViewer } from './transcript-viewer';
import { AISummaryPanel } from './ai-summary-panel';
import { EmailDraftModal } from './email-draft-modal';
import { fetchMeetingDetail, fetchTranscriptChunks } from '../../services/meetings';
import { getR2DownloadUrl, isR2Key } from '../../lib/r2-client';
import { NavPage } from '../types';
import type { Database } from '../../lib/database.types';
import {
  getSetting, exportToCSV, exportToNotion, exportToClickUp, exportToGoogleSheets,
  exportToHubSpot, exportToICS, exportToOneNoteHTML,
} from '../../lib/exports';
import { callOpenRouter } from '../../lib/openrouter';
import { syncToHubSpot, syncToSalesforce } from '../../lib/crm-sync';
import { notifySlack, notifyTeams } from '../../lib/slack-notify';
import { findRecurringOpenItems } from '../../lib/recurring-intel';
import { applyCompliance, isComplianceModeEnabled } from '../../lib/pii';
import { getGlobalProfiles, applySpeakerMap } from '../../lib/speaker-map';
import { logAudit } from '../../services/audit-log';
import { MeetingMinutes } from './meeting-minutes';
import { supabase } from '../../lib/supabase';

type MeetingRow = Database['public']['Tables']['meetings']['Row'];
type SummaryRow = Database['public']['Tables']['summaries']['Row'];
type ActionItemRow = Database['public']['Tables']['action_items']['Row'];
type ChunkRow = Database['public']['Tables']['transcript_chunks']['Row'];

const sourceIcons: Record<string, string> = {
  zoom: '🎥', meet: '📹', whatsapp: '💬', phone: '📱', upload: '📂', browser: '🎙️', teams: '💼',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtDuration(s?: number | null) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function chunksToUtterances(chunks: ChunkRow[]) {
  return chunks.map(c => ({
    id: c.id,
    speaker: c.speaker ?? 'Unknown',
    transcript: c.text,
    start: c.timestamp_start ?? 0,
    end: c.timestamp_end ?? 0,
    isFinal: c.is_final,
    words: (c.words as { word: string; punctuated_word?: string; start: number; end: number; confidence: number }[] | null) ?? [],
  }));
}

function buildSummaryForPanel(summary: SummaryRow, actionItems: ActionItemRow[]) {
  const overview = summary.overview as Record<string, unknown>;
  return {
    overview: {
      date: (overview?.date as string) ?? 'N/A',
      duration: (overview?.duration as string) ?? 'N/A',
      participants: (overview?.participants as string[]) ?? [],
      mainPurpose: (overview?.mainPurpose as string) ?? '',
    },
    keyDiscussionPoints: summary.key_discussion_points ?? [],
    keyDecisions: summary.key_decisions ?? [],
    actionItems: actionItems.map(ai => ({
      id: ai.id,
      meetingId: ai.meeting_id ?? '',
      owner: ai.owner ?? '',
      task: ai.task,
      dueDate: ai.due_date ?? '',
      status: ai.status as 'pending' | 'in_progress' | 'complete',
    })),
    followUpEmail: summary.follow_up_email ?? '',
    risks: summary.risks ?? [],
  };
}

interface MeetingDetailProps {
  meetingId: string;
  onNavigate: (page: NavPage, id?: string) => void;
}

export function MeetingDetail({ meetingId, onNavigate }: MeetingDetailProps) {
  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [actionItems, setActionItems] = useState<ActionItemRow[]>([]);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime]     = useState(0);
  const [signedAudioUrl, setSignedAudioUrl] = useState<string | null>(null);
  const [summaryMode, setSummaryMode]     = useState<'short' | 'client'>('short');
  const [mobileTab, setMobileTab] = useState<'transcript' | 'summary'>('transcript');
  const [showExportHub, setShowExportHub] = useState(false);
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [recurringItems, setRecurringItems] = useState<{ task: string; owner?: string; meetingTitle: string; meetingDate: string }[]>([]);
  const [showRecurring, setShowRecurring] = useState(true);
  const [detailView, setDetailView] = useState<'summary' | 'minutes'>('summary');
  const [agendaItems, setAgendaItems] = useState<string[]>([]);
  const [editingAgenda, setEditingAgenda] = useState(false);
  const [agendaDraft, setAgendaDraft] = useState<string[]>([]);
  const [agendaInput, setAgendaInput] = useState('');
  const [savingAgenda, setSavingAgenda] = useState(false);

  const handleParticipantsChange = useCallback(async (names: string[]) => {
    if (!summary) return;
    const overview = { ...(summary.overview as Record<string, unknown>), participants: names };
    setSummary(prev => prev ? { ...prev, overview } : prev);
    await supabase.from('summaries').update({ overview }).eq('id', summary.id);
  }, [summary]);
  const agendaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetchMeetingDetail(meetingId),
      fetchTranscriptChunks(meetingId),
    ])
      .then(([detail, chks]) => {
        if (!detail) { setError('Meeting not found'); return; }
        setMeeting(detail);
        setSummary(detail.summary);
        setActionItems(detail.action_items);
        setAgendaItems(detail.agenda_items ?? []);
        setChunks(chks);
        logAudit('view', 'meeting', meetingId).catch(() => {});
        findRecurringOpenItems(meetingId, detail.title)
          .then(items => setRecurringItems(items.map(i => ({
            task: i.task,
            owner: i.owner ?? undefined,
            meetingTitle: i.meetingTitle,
            meetingDate: new Date(i.meetingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          }))))
          .catch(() => {});
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [meetingId]);

  // Resolve signed audio URL: R2 key → 1-hour presigned GET; legacy public URL → use directly
  useEffect(() => {
    if (!meeting?.file_url) return;
    if (isR2Key(meeting.file_url)) {
      getR2DownloadUrl(meeting.file_url)
        .then(url => setSignedAudioUrl(url))
        .catch(() => setSignedAudioUrl(null));
    } else {
      setSignedAudioUrl(meeting.file_url);
    }
  }, [meeting?.file_url]);

  if (loading) {
    return (
      <div className="flex flex-col min-h-full">
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border px-4 sm:px-6 py-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-64 mt-1.5" />
        </div>
        <div className="p-4 sm:p-6 flex flex-col gap-4">
          <Skeleton className="h-[80px] w-full rounded-2xl" />
          <Skeleton className="h-[300px] w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-muted-foreground/50" />
        </div>
        <div className="text-center">
          <p className="text-[14px] font-medium text-foreground">Meeting not found</p>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">{error ?? 'This meeting may have been deleted.'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onNavigate('meetings')}>Back to Meetings</Button>
      </div>
    );
  }

  const globalProfiles = getGlobalProfiles();
  const profileMap: Record<string, string> = Object.fromEntries(globalProfiles.map(p => [p.label, p.realName]));
  const complianceOn = isComplianceModeEnabled();
  const utterances = chunksToUtterances(chunks).map(u => ({
    ...u,
    speaker: applySpeakerMap(u.speaker, profileMap),
    transcript: complianceOn ? applyCompliance(u.transcript) : u.transcript,
  }));
  const summaryForPanel = summary ? buildSummaryForPanel(summary, actionItems) : null;

  const handleShare = () => {
    const url = `${window.location.origin}${window.location.pathname}?meeting=${meeting.id}`;
    navigator.clipboard.writeText(url)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.error('Could not copy link'));
  };

  const buildTextExport = () => {
    const lines: string[] = [];
    lines.push(`# ${meeting.title}`);
    lines.push(`Date: ${fmtDate(meeting.created_at)}`);
    if (meeting.duration) lines.push(`Duration: ${fmtDuration(meeting.duration)}`);
    lines.push('');
    if (summaryForPanel) {
      if (summaryForPanel.overview.mainPurpose) { lines.push('## Purpose'); lines.push(summaryForPanel.overview.mainPurpose); lines.push(''); }
      if (summaryForPanel.keyDiscussionPoints.length > 0) { lines.push('## Key Discussion Points'); summaryForPanel.keyDiscussionPoints.forEach(p => lines.push(`• ${p}`)); lines.push(''); }
      if (summaryForPanel.keyDecisions.length > 0) { lines.push('## Key Decisions'); summaryForPanel.keyDecisions.forEach(d => lines.push(`• ${d}`)); lines.push(''); }
      if (summaryForPanel.actionItems.length > 0) { lines.push('## Action Items'); summaryForPanel.actionItems.forEach(ai => lines.push(`• ${ai.task}${ai.owner ? ` (${ai.owner})` : ''}${ai.dueDate ? ` — Due ${ai.dueDate}` : ''}`)); lines.push(''); }
      if (summaryForPanel.risks.length > 0) { lines.push('## Risks'); summaryForPanel.risks.forEach(r => lines.push(`• ${r}`)); lines.push(''); }
      if (summaryForPanel.followUpEmail) { lines.push('## Follow-up Email'); lines.push(summaryForPanel.followUpEmail); lines.push(''); }
    }
    if (utterances.length > 0) {
      lines.push('## Transcript');
      utterances.forEach(u => {
        const ts = [Math.floor(u.start / 60), Math.floor(u.start % 60)].map(n => String(n).padStart(2, '0')).join(':');
        lines.push(`[${ts}] ${u.speaker}: ${u.transcript}`);
      });
    }
    return lines.join('\n');
  };

  const handleExport = () => setShowExportHub(true);

  const exportItems = (summaryForPanel?.actionItems ?? []).map(ai => ({
    task: ai.task,
    owner: ai.owner,
    dueDate: ai.dueDate,
    status: ai.status,
  }));
  const transcriptText = utterances.map(u => {
    const ts = [Math.floor(u.start / 60), Math.floor(u.start % 60)].map(n => String(n).padStart(2, '0')).join(':');
    return `[${ts}] ${u.speaker}: ${u.transcript}`;
  }).join('\n');

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 max-w-[1400px] mx-auto w-full">
          <button
            onClick={() => onNavigate('meetings')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all flex-shrink-0"
            aria-label="Back to meetings"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <span className="text-[18px] flex-shrink-0">{sourceIcons[meeting.source] ?? '📂'}</span>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-foreground truncate leading-tight">{meeting.title}</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11.5px] text-muted-foreground hidden sm:block">{fmtDate(meeting.created_at)}</span>
                <span className="text-[11.5px] text-muted-foreground sm:hidden">
                  {new Date(meeting.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                {meeting.duration && (
                  <>
                    <span className="text-muted-foreground/40 text-[10px]">·</span>
                    <span className="text-[11.5px] text-muted-foreground">{fmtDuration(meeting.duration)}</span>
                  </>
                )}
                {(meeting.tags ?? []).slice(0, 2).map((tag: string) => (
                  <span key={tag} className="hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground">
                    <Tag className="w-2.5 h-2.5" />{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5 h-8 hidden sm:flex" onClick={handleShare}>
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Share</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 h-8 hidden sm:flex" onClick={() => setShowEmailDraft(true)}>
              <Mail className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Email</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 h-8 hidden sm:flex" onClick={handleExport}>
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Export</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 hidden sm:flex"
              onClick={() => {
                setDetailView('minutes');
                setTimeout(() => {
                  const prev = document.title;
                  document.title = `${meeting.title} — Meeting Minutes`;
                  window.print();
                  document.title = prev;
                }, 100);
              }}
            >
              <FileOutput className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Minutes PDF</span>
            </Button>
            <button className="sm:hidden w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile tab switcher */}
        <div className="lg:hidden flex border-t border-border">
          <button
            onClick={() => setMobileTab('transcript')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[12.5px] font-medium transition-colors ${
              mobileTab === 'transcript'
                ? 'text-primary border-b-2 border-primary bg-primary/3'
                : 'text-muted-foreground'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Transcript
          </button>
          <button
            onClick={() => setMobileTab('summary')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[12.5px] font-medium transition-colors ${
              mobileTab === 'summary'
                ? 'text-primary border-b-2 border-primary bg-primary/3'
                : 'text-muted-foreground'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Summary
          </button>
        </div>
      </div>

      {/* ── Email Draft Modal ── */}
      {showEmailDraft && (
        <EmailDraftModal
          meetingTitle={meeting.title}
          meetingDate={fmtDate(meeting.created_at)}
          participants={summaryForPanel?.overview.participants ?? []}
          keyPoints={summaryForPanel?.keyDiscussionPoints ?? []}
          decisions={summaryForPanel?.keyDecisions ?? []}
          actionItems={exportItems}
          onClose={() => setShowEmailDraft(false)}
        />
      )}

      {/* ── Export Hub Modal ── */}
      {showExportHub && (
        <ExportHubModal
          meetingTitle={meeting.title}
          meetingDate={fmtDate(meeting.created_at)}
          items={exportItems}
          summaryForPanel={summaryForPanel}
          transcriptText={transcriptText}
          meetingUrl={`${window.location.origin}${window.location.pathname}?meeting=${meeting.id}`}
          onClose={() => setShowExportHub(false)}
          onDownloadText={() => {
            const text = buildTextExport();
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), {
              href: url,
              download: `${meeting.title.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '_')}_${meeting.created_at.slice(0, 10)}.txt`,
            });
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Exported as text file');
          }}
        />
      )}

      {/* ── Recurring Intelligence Banner ── */}
      {recurringItems.length > 0 && showRecurring && (
        <div className="flex-shrink-0 mx-4 mt-3 sm:mx-6">
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <History className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
                {recurringItems.length} unresolved item{recurringItems.length > 1 ? 's' : ''} from previous meetings
              </p>
              <div className="mt-1.5 flex flex-col gap-1">
                {recurringItems.slice(0, 3).map((item, i) => (
                  <p key={i} className="text-[11.5px] text-amber-600 dark:text-amber-400 truncate">
                    • {item.task}{item.owner ? ` (${item.owner})` : ''} — from {item.meetingTitle} on {item.meetingDate}
                  </p>
                ))}
                {recurringItems.length > 3 && (
                  <p className="text-[11px] text-amber-500 dark:text-amber-500">+{recurringItems.length - 3} more</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowRecurring(false)}
              className="w-5 h-5 flex items-center justify-center rounded-lg text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Compliance indicator ── */}
      {complianceOn && (
        <div className="flex-shrink-0 mx-4 mt-2 sm:mx-6">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/8 border border-red-500/15">
            <ShieldAlert className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            <p className="text-[11.5px] text-red-600 dark:text-red-400">Compliance mode — PII redacted from transcript</p>
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden">

        {/* Mobile layout — single panel, toggled by tab */}
        <div className="lg:hidden flex flex-col h-full overflow-auto">
          {mobileTab === 'transcript' ? (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
                <AudioPlayer
                  audioUrl={signedAudioUrl}
                  duration={meeting.duration ?? 0}
                  currentTime={currentTime}
                  onTimeChange={setCurrentTime}
                />
              </div>
              <div className="flex-1 px-4 py-3">
                <Tabs defaultValue="transcript" className="flex flex-col h-full">
                  <TabsList className="w-full mb-3 flex-shrink-0">
                    <TabsTrigger value="transcript" className="flex-1 gap-1.5">
                      <FileText className="w-3.5 h-3.5" />Transcript
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="flex-1 gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />Ask AI
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="transcript" className="flex-1 mt-0">
                    {chunks.length === 0 ? (
                      <EmptyTranscript status={meeting.status} />
                    ) : (
                      <TranscriptViewer utterances={utterances} currentTime={currentTime} onSeek={setCurrentTime} />
                    )}
                  </TabsContent>
                  <TabsContent value="chat" className="flex-1 mt-0">
                    <AskAIPanel meetingTitle={meeting.title} />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          ) : (
            <div className="px-4 pt-4 pb-24">
              {/* Mobile Summary/Minutes toggle */}
              <div className="flex items-center gap-1 mb-4">
                <button
                  onClick={() => setDetailView('summary')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    detailView === 'summary' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />Summary
                </button>
                <button
                  onClick={() => setDetailView('minutes')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    detailView === 'minutes' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <ListOrdered className="w-3 h-3" />Minutes
                </button>
              </div>
              {detailView === 'summary' ? (
                summaryForPanel ? (
                  <AISummaryPanel summary={summaryForPanel} mode={summaryMode} onModeChange={setSummaryMode} onParticipantsChange={handleParticipantsChange} />
                ) : (
                  <EmptySummary status={meeting.status} />
                )
              ) : (
                <MeetingMinutes
                  meeting={meeting}
                  summary={summary}
                  actionItems={actionItems}
                  chunks={chunks}
                  speakerMap={profileMap}
                />
              )}
            </div>
          )}
        </div>

        {/* Desktop layout — split panel */}
        <div className="hidden lg:flex h-full overflow-hidden">

          {/* Left: Audio + Transcript */}
          <div className="flex flex-col flex-1 min-w-0 border-r border-border overflow-hidden">
            <div className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
              <AudioPlayer
                audioUrl={signedAudioUrl}
                duration={meeting.duration ?? 0}
                currentTime={currentTime}
                onTimeChange={setCurrentTime}
              />
            </div>
            <div className="flex-1 overflow-hidden px-6 py-4">
              <Tabs defaultValue="transcript" className="flex flex-col h-full">
                <TabsList className="w-full mb-4 flex-shrink-0">
                  <TabsTrigger value="transcript" className="flex-1 gap-1.5">
                    <FileText className="w-3.5 h-3.5" />Transcript
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="flex-1 gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />Ask AI
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="transcript" className="flex-1 overflow-hidden mt-0">
                  {chunks.length === 0 ? (
                    <EmptyTranscript status={meeting.status} />
                  ) : (
                    <TranscriptViewer utterances={utterances} currentTime={currentTime} onSeek={setCurrentTime} />
                  )}
                </TabsContent>
                <TabsContent value="chat" className="flex-1 mt-0">
                  <AskAIPanel meetingTitle={meeting.title} />
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* Right: Summary / Minutes */}
          <div className="w-[360px] xl:w-[420px] flex-shrink-0 flex flex-col overflow-hidden">
            {/* Toggle bar */}
            <div className="flex items-center gap-1 px-4 pt-4 pb-2 flex-shrink-0">
              <button
                onClick={() => setDetailView('summary')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  detailView === 'summary' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                <Sparkles className="w-3 h-3" />Summary
              </button>
              <button
                onClick={() => setDetailView('minutes')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  detailView === 'minutes' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                <ListOrdered className="w-3 h-3" />Minutes
              </button>
            </div>

            {/* Agenda editor (shown only in summary view) */}
            {detailView === 'summary' && (
              <div className="px-4 pb-2 flex-shrink-0">
                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agenda</p>
                    {!editingAgenda && (
                      <button
                        onClick={() => { setAgendaDraft([...agendaItems]); setEditingAgenda(true); setTimeout(() => agendaInputRef.current?.focus(), 50); }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Edit agenda"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {editingAgenda ? (
                    <>
                      <ol className="flex flex-col gap-1 mb-2">
                        {agendaDraft.map((item, i) => (
                          <li key={i} className="flex items-center gap-2 text-[11.5px]">
                            <span className="text-muted-foreground flex-shrink-0 w-4">{i + 1}.</span>
                            <span className="flex-1 text-foreground">{item}</span>
                            <button
                              onClick={() => setAgendaDraft(prev => prev.filter((_, j) => j !== i))}
                              className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </li>
                        ))}
                      </ol>
                      <div className="flex gap-1.5">
                        <input
                          ref={agendaInputRef}
                          value={agendaInput}
                          onChange={e => setAgendaInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && agendaInput.trim()) {
                              setAgendaDraft(prev => [...prev, agendaInput.trim()]);
                              setAgendaInput('');
                            }
                          }}
                          placeholder="Add agenda item…"
                          className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <button
                          onClick={() => {
                            if (agendaInput.trim()) {
                              setAgendaDraft(prev => [...prev, agendaInput.trim()]);
                              setAgendaInput('');
                              agendaInputRef.current?.focus();
                            }
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          onClick={async () => {
                            setSavingAgenda(true);
                            try {
                              await supabase.from('meetings').update({ agenda_items: agendaDraft }).eq('id', meetingId);
                              setAgendaItems(agendaDraft);
                              setEditingAgenda(false);
                            } finally {
                              setSavingAgenda(false);
                            }
                          }}
                          disabled={savingAgenda}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {savingAgenda ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                        <button
                          onClick={() => setEditingAgenda(false)}
                          className="px-2.5 py-1 rounded-lg text-muted-foreground hover:text-foreground text-[11px] transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : agendaItems.length > 0 ? (
                    <ol className="flex flex-col gap-1">
                      {agendaItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11.5px]">
                          <span className="text-muted-foreground flex-shrink-0 w-4 mt-0.5">{i + 1}.</span>
                          <span className="text-foreground">{item}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground italic">No agenda recorded.</p>
                  )}
                </div>
              </div>
            )}

            {/* Panel content */}
            <div className="flex-1 overflow-y-auto">
              {detailView === 'summary' ? (
                <div className="px-4 pb-5">
                  {summaryForPanel ? (
                    <AISummaryPanel summary={summaryForPanel} mode={summaryMode} onModeChange={setSummaryMode} onParticipantsChange={handleParticipantsChange} />
                  ) : (
                    <EmptySummary status={meeting.status} />
                  )}
                </div>
              ) : (
                <MeetingMinutes
                  meeting={meeting}
                  summary={summary}
                  actionItems={actionItems}
                  chunks={chunks}
                  speakerMap={profileMap}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type ExportHubSummary = { keyDiscussionPoints?: string[]; keyDecisions?: string[]; risks?: string[] } | null;

interface ExportHubItem { task: string; owner?: string | null; dueDate?: string | null; status: string; }

function ExportHubModal({
  meetingTitle, meetingDate, items, summaryForPanel, transcriptText, meetingUrl, onClose, onDownloadText,
}: {
  meetingTitle: string;
  meetingDate: string;
  items: ExportHubItem[];
  summaryForPanel: ExportHubSummary;
  transcriptText: string;
  meetingUrl?: string;
  onClose: () => void;
  onDownloadText: () => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, 'idle' | 'loading' | 'ok' | 'error'>>({});
  const [errors, setErrors]     = useState<Record<string, string>>({});

  const setStatus = (key: string, s: typeof statuses[string]) => setStatuses(prev => ({ ...prev, [key]: s }));
  const setError  = (key: string, msg: string)                 => setErrors(prev => ({ ...prev, [key]: msg }));

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setStatus(key, 'loading');
    try {
      const res = await fn();
      if (res.ok) {
        setStatus(key, 'ok');
        logAudit('export', 'meeting', undefined, { destination: key, meetingTitle }).catch(() => {});
      } else {
        setStatus(key, 'error');
        setError(key, res.error ?? 'Unknown error');
      }
    } catch (err) {
      setStatus(key, 'error');
      setError(key, err instanceof Error ? err.message : String(err));
    }
  };

  const hubspotContactEmail = '';

  const notifyPayload = {
    meetingTitle,
    summary: [
      summaryForPanel?.keyDiscussionPoints?.slice(0, 3).map(p => `• ${p}`).join('\n') ?? '',
      summaryForPanel?.keyDecisions?.slice(0, 2).map(d => `✓ ${d}`).join('\n') ?? '',
    ].filter(Boolean).join('\n\n') || 'No summary available.',
    actionItems: items.map(i => `${i.task}${i.owner ? ` (${i.owner})` : ''}${i.dueDate ? ` — Due ${i.dueDate}` : ''}`),
    meetingUrl,
  };

  const crmSummaryText = [
    summaryForPanel?.keyDiscussionPoints?.length
      ? `Key Points:\n${summaryForPanel.keyDiscussionPoints.map(p => `- ${p}`).join('\n')}`
      : '',
    summaryForPanel?.keyDecisions?.length
      ? `Decisions:\n${summaryForPanel.keyDecisions.map(d => `- ${d}`).join('\n')}`
      : '',
    summaryForPanel?.risks?.length
      ? `Risks:\n${summaryForPanel.risks.map(r => `- ${r}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n') || 'No summary available.';

  const crmPayload = {
    meetingTitle,
    summary: crmSummaryText,
    actionItems: items.map(i => `${i.task}${i.owner ? ` (${i.owner})` : ''}${i.dueDate ? ` — Due ${i.dueDate}` : ''}`),
  };

  const exportOptions = [
    {
      key: 'text',
      label: 'Text File',
      description: 'Full transcript + summary as .txt',
      icon: FileText,
      iconColor: 'text-slate-600 dark:text-slate-400',
      iconBg: 'bg-slate-500/10',
      action: () => { onDownloadText(); setStatus('text', 'ok'); },
      isSync: true,
    },
    {
      key: 'csv',
      label: 'CSV',
      description: 'Action items as a spreadsheet',
      icon: FileSpreadsheet,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-500/10',
      action: () => { exportToCSV(items, meetingTitle); setStatus('csv', 'ok'); },
      isSync: true,
    },
    {
      key: 'ical',
      label: 'Calendar (.ics)',
      description: 'Action items as calendar events',
      icon: Calendar,
      iconColor: 'text-blue-600 dark:text-blue-400',
      iconBg: 'bg-blue-500/10',
      action: () => { exportToICS(items, meetingTitle, undefined); setStatus('ical', 'ok'); },
      isSync: true,
    },
    {
      key: 'onenote',
      label: 'OneNote / HTML',
      description: 'Download as formatted HTML',
      icon: BookOpen,
      iconColor: 'text-violet-600 dark:text-violet-400',
      iconBg: 'bg-violet-500/10',
      action: () => {
        exportToOneNoteHTML(meetingTitle, meetingDate, summaryForPanel ? {
          keyPoints: summaryForPanel.keyDiscussionPoints,
          decisions: summaryForPanel.keyDecisions,
          risks: summaryForPanel.risks,
        } : null, items, transcriptText);
        setStatus('onenote', 'ok');
      },
      isSync: true,
    },
    {
      key: 'notion',
      label: 'Notion',
      description: 'Create pages in your Notion database',
      icon: BookOpen,
      iconColor: 'text-orange-600 dark:text-orange-400',
      iconBg: 'bg-orange-500/10',
      action: () => run('notion', () => exportToNotion(items, meetingTitle)),
    },
    {
      key: 'clickup',
      label: 'ClickUp',
      description: 'Create tasks in your ClickUp list',
      icon: SquareCheck,
      iconColor: 'text-purple-600 dark:text-purple-400',
      iconBg: 'bg-purple-500/10',
      action: () => run('clickup', () => exportToClickUp(items, meetingTitle)),
    },
    {
      key: 'sheets',
      label: 'Google Sheets',
      description: 'Send to your Apps Script web app',
      icon: FileSpreadsheet,
      iconColor: 'text-teal-600 dark:text-teal-400',
      iconBg: 'bg-teal-500/10',
      action: () => run('sheets', () => exportToGoogleSheets(items, meetingTitle)),
    },
    {
      key: 'hubspot',
      label: 'HubSpot CRM',
      description: 'Create a note with action items',
      icon: Globe,
      iconColor: 'text-red-600 dark:text-red-400',
      iconBg: 'bg-red-500/10',
      action: () => run('hubspot', () => exportToHubSpot(items, meetingTitle, hubspotContactEmail || undefined)),
    },
    {
      key: 'hubspot-sync',
      label: 'HubSpot Auto-Sync',
      description: 'Sync summary + all action items via edge function',
      icon: Globe,
      iconColor: 'text-orange-600 dark:text-orange-400',
      iconBg: 'bg-orange-500/10',
      action: () => run('hubspot-sync', () => syncToHubSpot(crmPayload)),
    },
    {
      key: 'salesforce',
      label: 'Salesforce CRM',
      description: 'Create Tasks in Salesforce from action items',
      icon: Globe,
      iconColor: 'text-sky-600 dark:text-sky-400',
      iconBg: 'bg-sky-500/10',
      action: () => run('salesforce', () => syncToSalesforce(crmPayload)),
    },
    {
      key: 'slack',
      label: 'Post to Slack',
      description: 'Send summary + action items to your Slack channel',
      icon: MessageSquare,
      iconColor: 'text-green-600 dark:text-green-400',
      iconBg: 'bg-green-500/10',
      action: () => run('slack', () => notifySlack(notifyPayload)),
    },
    {
      key: 'teams',
      label: 'Post to Teams',
      description: 'Send an Adaptive Card to your Teams channel',
      icon: Users,
      iconColor: 'text-violet-600 dark:text-violet-400',
      iconBg: 'bg-violet-500/10',
      action: () => run('teams', () => notifyTeams(notifyPayload)),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-[480px] bg-background rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <Download className="w-4 h-4 text-primary" />
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-foreground">Export Meeting</h2>
            <p className="text-[11.5px] text-muted-foreground truncate">{meetingTitle}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Export options */}
        <div className="overflow-y-auto flex-1 p-4">
          {items.length === 0 && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-[11.5px] text-amber-600 dark:text-amber-400">No action items found — some exports will be empty.</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {exportOptions.map(opt => {
              const Icon = opt.icon;
              const s = statuses[opt.key] ?? 'idle';
              return (
                <div key={opt.key} className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent/30 transition-colors">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${opt.iconBg}`}>
                    <Icon className={`w-4 h-4 ${opt.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">{opt.label}</p>
                    <p className="text-[11px] text-muted-foreground">{opt.description}</p>
                    {s === 'error' && errors[opt.key] && (
                      <p className="text-[11px] text-destructive mt-0.5">{errors[opt.key]}</p>
                    )}
                  </div>
                  <button
                    onClick={() => opt.action()}
                    disabled={s === 'loading' || s === 'ok'}
                    className={`flex-shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-all ${
                      s === 'ok'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default'
                        : s === 'error'
                        ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                        : s === 'loading'
                        ? 'bg-muted text-muted-foreground cursor-wait'
                        : 'bg-primary/10 text-primary hover:bg-primary/20'
                    }`}
                  >
                    {s === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {s === 'ok' && <CheckCircle2 className="w-3 h-3" />}
                    {s === 'ok' ? 'Done' : s === 'loading' ? 'Exporting…' : s === 'error' ? 'Retry' : 'Export'}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground text-center mt-3 leading-relaxed">
            API-based exports require credentials configured in <strong>Settings → Export Integrations</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyTranscript({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
        <FileText className="w-5 h-5 text-muted-foreground/40" />
      </div>
      <div>
        <p className="text-[13.5px] font-medium text-foreground">No transcript</p>
        <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
          {status === 'complete' ? 'Transcript not available for this meeting.' : 'Transcript will appear when processing is complete.'}
        </p>
      </div>
    </div>
  );
}

function EmptySummary({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-violet-400" />
      </div>
      <div>
        <p className="text-[14px] font-medium text-foreground">No summary yet</p>
        <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed max-w-[220px]">
          {status === 'complete' ? 'Summary was not generated for this recording.' : 'Summary will appear once processing is complete.'}
        </p>
      </div>
    </div>
  );
}

function AskAIPanel({ meetingTitle }: { meetingTitle: string }) {
  const [messages, setMessages] = useState([
    { role: 'ai' as const, text: `Hi! I've loaded "${meetingTitle}". Ask me anything about this meeting.` },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);
    try {
      const apiKey = getSetting('OPENROUTER_API_KEY');
      const answer = await callOpenRouter(
        apiKey,
        [
          { role: 'system', content: `You are an AI assistant helping analyze a meeting titled "${meetingTitle}". Answer questions concisely and helpfully.` },
          { role: 'user',   content: userMsg },
        ],
        'ask-ai',
      );
      setMessages(prev => [...prev, { role: 'ai', text: answer }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 min-h-0 max-h-[340px] lg:max-h-none">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[12.5px] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-muted text-foreground rounded-bl-md'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted px-3.5 py-2.5 rounded-2xl rounded-bl-md flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about this meeting…"
          className="flex-1 px-3.5 py-2 rounded-xl bg-muted text-[13px] text-foreground placeholder:text-muted-foreground border border-transparent focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 transition-all"
        />
        <Button size="sm" onClick={send} disabled={!input.trim()} className="h-9 px-3.5">Send</Button>
      </div>
    </div>
  );
}

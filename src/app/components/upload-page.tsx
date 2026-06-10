import { useState, useRef, useCallback } from 'react';
import {
  Upload, FileAudio, FileVideo, X, CheckCircle2, Loader2, ArrowRight,
  Lock, Cpu, RefreshCw, AlertCircle, Zap, AlertTriangle, Plus, ListOrdered,
} from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { NavPage } from '../types';
import { runUploadPipeline } from '../../lib/upload-pipeline';
import type { PipelineUpdate, PipelineStage } from '../../lib/upload-pipeline';

// ─── Types ─────────────────────────────────────────────────────────────────────

type MeetingSource = 'zoom' | 'meet' | 'whatsapp' | 'phone' | 'upload';

interface UploadedFile {
  id:             string;
  file:           File;
  stage:          PipelineStage;
  pct:            number;
  detail?:        string;
  error?:         string;
  meetingId?:     string;
  stats?:         PipelineUpdate['stats'];
  storageWarning?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_SIZE_MB = 200;

const SOURCE_OPTIONS: { id: MeetingSource; label: string; emoji: string; desc: string }[] = [
  { id: 'zoom',     label: 'Zoom',        emoji: '🎥', desc: 'MP4, M4A'  },
  { id: 'meet',     label: 'Google Meet', emoji: '📹', desc: 'MP4, WebM' },
  { id: 'whatsapp', label: 'WhatsApp',    emoji: '💬', desc: 'OGG, MP3'  },
  { id: 'phone',    label: 'Phone',       emoji: '📱', desc: 'MP3, WAV'  },
  { id: 'upload',   label: 'Other',       emoji: '📂', desc: 'Any'       },
];

const MODE_OPTIONS = [
  { id: 'short',  label: 'Short Mode',  desc: 'Concise summary under 300 words, focused on action items', badge: 'Default' },
  { id: 'client', label: 'Client Mode', desc: 'Polished, professional tone — ready to share with clients',  badge: 'Premium' },
];

const ACCEPTED_EXTS = ['mp4', 'mp3', 'wav', 'm4a', 'ogg', 'webm', 'mov', 'flac', 'aac'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDuration(s: number): string {
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function stageLabel(stage: PipelineStage, detail?: string): string {
  if (detail) return detail;
  switch (stage) {
    case 'extracting':   return 'Extracting audio…';
    case 'transcribing': return 'Transcribing with Deepgram Nova-3…';
    case 'summarizing':  return 'Generating AI summary…';
    case 'saving':       return 'Saving to library…';
    case 'complete':     return 'Complete';
    case 'error':        return 'Failed';
  }
}

function stageColor(stage: PipelineStage): string {
  switch (stage) {
    case 'extracting':   return 'text-blue-500';
    case 'transcribing': return 'text-violet-500';
    case 'summarizing':  return 'text-amber-500';
    case 'saving':       return 'text-teal-500';
    case 'complete':     return 'text-emerald-500';
    case 'error':        return 'text-destructive';
  }
}

function barColor(stage: PipelineStage): string {
  switch (stage) {
    case 'extracting':   return 'bg-blue-500';
    case 'transcribing': return 'bg-violet-500';
    case 'summarizing':  return 'bg-amber-500';
    case 'saving':       return 'bg-teal-500';
    case 'complete':     return 'bg-emerald-500';
    case 'error':        return 'bg-destructive';
  }
}

// ─── File card ────────────────────────────────────────────────────────────────

function FileCard({
  item,
  onNavigate,
  onRetry,
  onRemove,
}: {
  item:       UploadedFile;
  onNavigate: (page: NavPage) => void;
  onRetry:    (id: string) => void;
  onRemove:   (id: string) => void;
}) {
  const isProcessing = item.stage !== 'complete' && item.stage !== 'error';
  const isVideo      = item.file.type.startsWith('video');

  return (
    <Card className="border-border shadow-none bg-card overflow-hidden">
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
            {isVideo
              ? <FileVideo className="w-4 h-4 text-muted-foreground" />
              : <FileAudio className="w-4 h-4 text-muted-foreground" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-foreground truncate">{item.file.name}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {isProcessing && <Loader2 className={`w-4 h-4 animate-spin ${stageColor(item.stage)}`} />}
                {item.stage === 'complete' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                {item.stage === 'error' && (
                  <>
                    <button onClick={() => onRetry(item.id)} title="Retry">
                      <RefreshCw className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                    </button>
                    <button onClick={() => onRemove(item.id)} title="Dismiss">
                      <X className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground">{fmtSize(item.file.size)}</span>
              <span className="text-muted-foreground/40 text-[10px]">·</span>
              <span className={`text-[11px] font-medium ${stageColor(item.stage)}`}>
                {stageLabel(item.stage, item.detail)}
              </span>
            </div>

            {isProcessing && (
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor(item.stage)}`}
                  style={{ width: `${item.pct}%` }}
                />
              </div>
            )}

            {item.stage === 'error' && item.error && (
              <div className="mt-2 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-destructive leading-relaxed">{item.error}</p>
              </div>
            )}

            {item.stage === 'complete' && item.stats && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  <Zap className="w-2.5 h-2.5" />{item.stats.compressionPct}% smaller
                </span>
                <span className="text-[10.5px] text-muted-foreground">{fmtDuration(item.stats.duration)}</span>
                {item.stats.speakerCount > 0 && (
                  <span className="text-[10.5px] text-muted-foreground">
                    {item.stats.speakerCount} speaker{item.stats.speakerCount > 1 ? 's' : ''}
                  </span>
                )}
                {item.meetingId && (
                  <button
                    onClick={() => onNavigate('meetings')}
                    className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
                  >
                    View in Meetings <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {item.stage === 'complete' && !item.stats && item.meetingId && (
              <button
                onClick={() => onNavigate('meetings')}
                className="flex items-center gap-1 text-[12px] text-primary hover:text-primary/80 transition-colors mt-1 font-medium"
              >
                View in Meetings <ArrowRight className="w-3 h-3" />
              </button>
            )}

            {item.storageWarning && (
              <div className="mt-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">{item.storageWarning}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface UploadPageProps {
  onNavigate: (page: NavPage, meetingId?: string) => void;
}

export function UploadPage({ onNavigate }: UploadPageProps) {
  const [dragging, setDragging]             = useState(false);
  const [uploads, setUploads]               = useState<UploadedFile[]>([]);
  const [selectedSource, setSelectedSource] = useState<MeetingSource>('upload');
  const [selectedMode, setSelectedMode]     = useState('short');
  const [agendaItems, setAgendaItems]       = useState<string[]>([]);
  const [agendaInput, setAgendaInput]       = useState('');
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const agendaInputRef = useRef<HTMLInputElement>(null);

  const addAgendaItem = () => {
    const trimmed = agendaInput.trim();
    if (!trimmed) return;
    setAgendaItems(prev => [...prev, trimmed]);
    setAgendaInput('');
    agendaInputRef.current?.focus();
  };

  const removeAgendaItem = (idx: number) => {
    setAgendaItems(prev => prev.filter((_, i) => i !== idx));
  };

  const patch = useCallback((id: string, update: Partial<UploadedFile>) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...update } : u));
  }, []);

  const startPipeline = useCallback(async (item: UploadedFile, source: MeetingSource, mode: string, agenda: string[]) => {
    const title = item.file.name
      .replace(/\.[^/.]+$/, '').replace(/[_\-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase()).trim() || 'Meeting Recording';

    await runUploadPipeline(
      item.file,
      { source, mode: mode as 'short' | 'client', title, agendaItems: agenda },
      (update: PipelineUpdate) => {
        patch(item.id, {
          stage:          update.stage,
          pct:            update.pct,
          detail:         update.detail,
          error:          update.error,
          meetingId:      update.meetingId,
          stats:          update.stats,
          storageWarning: update.storageWarning,
        });
        // Navigate to meetings immediately when complete so the row is visible
        if (update.stage === 'complete' && update.meetingId) {
          setTimeout(() => onNavigate('meetings'), 800);
        }
      },
    );
  }, [patch]);

  const handleFiles = useCallback((files: File[]) => {
    const valid = files.filter(f => {
      if (f.size > MAX_SIZE_MB * 1024 * 1024) return false;
      if (f.type.startsWith('audio/') || f.type.startsWith('video/')) return true;
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return ACCEPTED_EXTS.includes(ext);
    });
    const src    = selectedSource;
    const mode   = selectedMode;
    const agenda = agendaItems;
    const newItems: UploadedFile[] = valid.map(f => ({
      id: crypto.randomUUID(), file: f, stage: 'extracting' as PipelineStage, pct: 0,
    }));
    setUploads(prev => [...prev, ...newItems]);
    newItems.forEach(item => startPipeline(item, src, mode, agenda));
  }, [selectedSource, selectedMode, startPipeline]);

  const retryFile = useCallback((id: string) => {
    const item = uploads.find(u => u.id === id);
    if (!item) return;
    const reset: UploadedFile = { ...item, stage: 'extracting', pct: 0, error: undefined, detail: undefined };
    patch(id, { stage: 'extracting', pct: 0, error: undefined, detail: undefined });
    startPipeline(reset, selectedSource, selectedMode, agendaItems);
  }, [uploads, selectedSource, selectedMode, agendaItems, patch, startPipeline]);

  const removeFile = useCallback((id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id));
  }, []);

  const onDrop      = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }, [handleFiles]);
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) handleFiles(Array.from(e.target.files)); e.target.value = ''; };

  return (
    <div className="flex flex-col min-h-full">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="px-4 sm:px-6 py-4 max-w-[960px] mx-auto w-full">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-[17px] font-semibold text-foreground">Upload Recording</h1>
              <p className="text-[12.5px] text-muted-foreground mt-0.5 hidden sm:block">
                Audio is extracted and transcribed in your browser — transcript and summary saved to your library.
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex-shrink-0">
              <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400 hidden sm:inline">Privacy-first</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-[960px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5">

          {/* ── LEFT ── */}
          <div className="flex flex-col gap-5">

            {/* Drop zone */}
            <div
              onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative border-2 border-dashed rounded-2xl p-8 sm:p-12
                flex flex-col items-center justify-center gap-4 cursor-pointer select-none transition-all
                ${dragging
                  ? 'border-primary bg-primary/5 scale-[1.01]'
                  : 'border-border hover:border-primary/40 hover:bg-muted/30 bg-card'}
              `}
            >
              <input ref={fileInputRef} type="file" multiple accept="audio/*,video/*" className="hidden" onChange={onFileInput} />
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragging ? 'bg-primary/10' : 'bg-muted'}`}>
                <Upload className={`w-6 h-6 transition-colors ${dragging ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div className="text-center">
                <p className="text-[15px] font-semibold text-foreground">
                  {dragging ? 'Drop your file here' : 'Drag & drop your recording'}
                </p>
                <p className="text-[13px] text-muted-foreground mt-1">
                  or <span className="text-primary font-medium">browse files</span>
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {['MP4', 'MP3', 'WAV', 'M4A', 'OGG', 'WebM', 'FLAC'].map(ext => (
                  <span key={ext} className="text-[10.5px] text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
                    .{ext.toLowerCase()}
                  </span>
                ))}
              </div>
              <p className="text-[11.5px] text-muted-foreground">Max {MAX_SIZE_MB} MB · Audio extracted client-side</p>
            </div>

            {/* Upload queue */}
            {uploads.length > 0 && (
              <div className="flex flex-col gap-2">
                {uploads.map(u => (
                  <FileCard
                    key={u.id}
                    item={u}
                    onNavigate={onNavigate}
                    onRetry={retryFile}
                    onRemove={removeFile}
                  />
                ))}
              </div>
            )}

            {/* Source selector */}
            <div>
              <p className="text-[13px] font-semibold text-foreground mb-2.5">Recording Source</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {SOURCE_OPTIONS.map(src => (
                  <button
                    key={src.id}
                    onClick={() => setSelectedSource(src.id)}
                    className={`
                      flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all
                      ${selectedSource === src.id
                        ? 'border-primary bg-primary/5 shadow-sm shadow-primary/10'
                        : 'border-border hover:border-primary/30 hover:bg-muted/40 bg-card'}
                    `}
                  >
                    <span className="text-[20px] leading-none">{src.emoji}</span>
                    <span className="text-[11.5px] font-medium text-foreground leading-tight">{src.label}</span>
                    <span className="text-[10px] text-muted-foreground">{src.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT ── */}
          <div className="flex flex-col gap-4">

            {/* Output mode */}
            <Card className="border-border shadow-none bg-card">
              <CardContent className="px-4 py-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Output Mode</p>
                <div className="flex flex-col gap-2">
                  {MODE_OPTIONS.map(mode => (
                    <button
                      key={mode.id}
                      onClick={() => setSelectedMode(mode.id)}
                      className={`
                        text-left p-3 rounded-xl border transition-all
                        ${selectedMode === mode.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/25 hover:bg-muted/30 bg-card'}
                      `}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12.5px] font-semibold text-foreground">{mode.label}</span>
                        <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                          mode.badge === 'Default'
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20'
                        }`}>{mode.badge}</span>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground leading-relaxed">{mode.desc}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Agenda */}
            <Card className="border-border shadow-none bg-card">
              <CardContent className="px-4 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <ListOrdered className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-[13px] font-semibold text-foreground">Agenda</p>
                  <span className="text-[10px] text-muted-foreground ml-auto">Optional</span>
                </div>
                {agendaItems.length > 0 && (
                  <ol className="flex flex-col gap-1 mb-3">
                    {agendaItems.map((item, idx) => (
                      <li key={idx} className="flex items-center gap-2 group">
                        <span className="text-[10px] text-muted-foreground w-4 text-right flex-shrink-0">{idx + 1}.</span>
                        <span className="text-[12px] text-foreground flex-1 truncate">{item}</span>
                        <button
                          onClick={() => removeAgendaItem(idx)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="flex gap-1.5">
                  <input
                    ref={agendaInputRef}
                    value={agendaInput}
                    onChange={e => setAgendaInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAgendaItem(); } }}
                    placeholder="e.g. Budget review"
                    className="flex-1 text-[12px] bg-muted border border-border rounded-lg px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button
                    onClick={addAgendaItem}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors flex-shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Supported formats */}
            <Card className="border-border shadow-none bg-card">
              <CardContent className="px-4 py-4">
                <p className="text-[13px] font-semibold text-foreground mb-2.5">Supported Formats</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {['MP4', 'MP3', 'WAV', 'M4A', 'OGG', 'WebM', 'MOV', 'FLAC', 'AAC'].map(ext => (
                    <span key={ext} className="text-[10.5px] text-center text-muted-foreground bg-muted px-2 py-1 rounded font-mono">
                      .{ext.toLowerCase()}
                    </span>
                  ))}
                </div>
                <p className="text-[10.5px] text-muted-foreground mt-2.5">
                  Video files: audio extracted automatically. Max {MAX_SIZE_MB} MB.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  Clock, FileText, CheckSquare, TrendingUp,
  ArrowRight, Upload, Zap, Radio, AlertTriangle, X,
} from 'lucide-react';
import { getSetting } from '../../lib/exports';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Skeleton } from './ui/skeleton';
import { fetchMeetings, fetchStats } from '../../services/meetings';
import { NavPage } from '../types';
import type { Database } from '../../lib/database.types';

type MeetingRow = Database['public']['Tables']['meetings']['Row'];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const sourceIcons: Record<string, string> = {
  zoom: '🎥', meet: '📹', whatsapp: '💬', phone: '📱', upload: '📂', browser: '🎙️', teams: '💼',
};

const statusConfig: Record<string, { pill: string; dot: string; label: string }> = {
  complete:    { pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-400', dot: 'bg-emerald-500', label: 'Complete' },
  transcribing:{ pill: 'bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-400',             dot: 'bg-blue-500',   label: 'Transcribing' },
  summarizing: { pill: 'bg-violet-50 text-violet-700 dark:bg-violet-500/12 dark:text-violet-400',     dot: 'bg-violet-500', label: 'Summarizing' },
  uploading:   { pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-400',         dot: 'bg-amber-500',  label: 'Uploading' },
  error:       { pill: 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-400',                 dot: 'bg-red-500',    label: 'Error' },
};

function fmt(s?: number | null) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Sparkline({ data }: { data: { day: string; meetings: number }[] }) {
  if (!data || data.length < 2) return null;
  const W = 280, H = 72;
  const pad = { t: 4, r: 4, b: 20, l: 4 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const max = Math.max(...data.map(d => d.meetings), 1);
  const step = cw / (data.length - 1);
  const pts = data.map((d, i) => ({
    x: pad.l + i * step,
    y: pad.t + ch - (d.meetings / max) * ch,
    label: d.day,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length-1].x},${pad.t+ch} L${pts[0].x},${pad.t+ch} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f46e5" stopOpacity=".15" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sg)" />
      <path d={line} fill="none" stroke="#4f46e5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map(p => (
        <text key={p.label} x={p.x} y={H - 4} textAnchor="middle" fontSize="9" fill="currentColor" opacity=".38">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

const REQUIRED_KEYS: { key: Parameters<typeof getSetting>[0]; label: string }[] = [
  { key: 'DEEPGRAM_API_KEY',   label: 'Deepgram (transcription)' },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter (AI summaries)' },
];

function SetupBanner({ onNavigate, onDismiss }: { onNavigate: (page: NavPage) => void; onDismiss: () => void }) {
  const missing = REQUIRED_KEYS.filter(k => !getSetting(k.key));
  if (missing.length === 0) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium leading-snug">
          API keys required before processing meetings
        </p>
        <p className="text-[12px] mt-0.5 opacity-80">
          Missing: {missing.map(k => k.label).join(', ')}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onNavigate('settings')}
          className="text-[12px] font-medium underline underline-offset-2 hover:no-underline transition-all"
        >
          Go to Settings
        </button>
        <button onClick={onDismiss} className="opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function DashboardPage({ onNavigate }: { onNavigate: (page: NavPage, id?: string) => void }) {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [stats, setStats] = useState({ totalMeetings: 0, hoursTranscribed: 0, actionItemsGenerated: 0, timeSavedHours: 0 });
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem('setup_banner_dismissed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    Promise.all([fetchMeetings(), fetchStats()])
      .then(([m, s]) => { setMeetings(m.slice(0, 5)); setStats(s); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const weeklyData = DAYS.map(day => ({ day, meetings: 0 }));
  meetings.forEach(m => {
    const name = DAY_NAMES[new Date(m.created_at).getDay()];
    const entry = weeklyData.find(d => d.day === name);
    if (entry) entry.meetings++;
  });

  const statCards = [
    { label: 'Total Meetings',    value: stats.totalMeetings,        suffix: '',  icon: FileText,    iconCls: 'text-indigo-600 dark:text-indigo-400', bgCls: 'bg-indigo-50 dark:bg-indigo-500/10' },
    { label: 'Hours Transcribed', value: stats.hoursTranscribed,     suffix: 'h', icon: Clock,       iconCls: 'text-emerald-600 dark:text-emerald-400', bgCls: 'bg-emerald-50 dark:bg-emerald-500/10' },
    { label: 'Action Items',      value: stats.actionItemsGenerated, suffix: '',  icon: CheckSquare, iconCls: 'text-violet-600 dark:text-violet-400', bgCls: 'bg-violet-50 dark:bg-violet-500/10' },
    { label: 'Time Saved',        value: stats.timeSavedHours,       suffix: 'h', icon: TrendingUp,  iconCls: 'text-amber-600 dark:text-amber-400', bgCls: 'bg-amber-50 dark:bg-amber-500/10' },
  ];

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Sticky page header ── */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 max-w-[1200px] mx-auto w-full">
          <div>
            <h1 className="text-[17px] font-semibold text-foreground leading-tight">Dashboard</h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5 hidden sm:block">Your meeting intelligence at a glance</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => onNavigate('live')}
              size="sm"
              className="gap-1.5 h-8 px-3 bg-red-500 hover:bg-red-600 text-white border-0 shadow-sm shadow-red-500/25"
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Go Live</span>
              <span className="sm:hidden">Live</span>
            </Button>
            <Button
              onClick={() => onNavigate('upload')}
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 px-3"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Upload</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-[1200px] mx-auto w-full">

        {/* Setup banner — shown when required API keys are missing */}
        {!bannerDismissed && (
          <SetupBanner
            onNavigate={onNavigate}
            onDismiss={() => {
              setBannerDismissed(true);
              try { sessionStorage.setItem('setup_banner_dismissed', '1'); } catch { /* ignore */ }
            }}
          />
        )}

        {/* Stat cards — 2 col mobile, 4 col desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {statCards.map(s => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="border-border shadow-none hover:shadow-sm transition-shadow bg-card">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-medium text-muted-foreground truncate">{s.label}</p>
                      {loading
                        ? <Skeleton className="h-7 w-12 mt-1.5" />
                        : <p className="text-[26px] sm:text-[30px] font-semibold text-foreground mt-1 leading-none tabular-nums">
                            {s.value}{s.suffix}
                          </p>
                      }
                    </div>
                    <div className={`w-9 h-9 rounded-xl ${s.bgCls} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`w-[17px] h-[17px] ${s.iconCls}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Main grid — stacked mobile, 2-col desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_292px] gap-4 sm:gap-5">

          {/* Recent Meetings */}
          <Card className="border-border shadow-none bg-card">
            <CardHeader className="px-5 pt-5 pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[14px] font-semibold">Recent Meetings</CardTitle>
              <button
                onClick={() => onNavigate('meetings')}
                className="text-[12px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
              >
                View all <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {loading ? (
                <div className="flex flex-col gap-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-[52px] w-full rounded-xl" />)}
                </div>
              ) : meetings.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground/40" />
                  </div>
                  <div>
                    <p className="text-[14px] font-medium text-foreground">No meetings yet</p>
                    <p className="text-[12.5px] text-muted-foreground mt-0.5">Upload or start a live session to begin</p>
                  </div>
                  <Button size="sm" onClick={() => onNavigate('upload')} className="mt-1">Upload recording</Button>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border -mx-1">
                  {meetings.map(m => {
                    const sc = statusConfig[m.status] ?? { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground', label: m.status };
                    return (
                      <div
                        key={m.id}
                        onClick={() => m.status === 'complete' && onNavigate('meeting-detail', m.id)}
                        className={`flex items-center gap-3 px-1 py-3 first:pt-1 last:pb-1 rounded-lg transition-colors ${m.status === 'complete' ? 'cursor-pointer hover:bg-muted/40 group' : ''}`}
                      >
                        <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-[16px] flex-shrink-0">
                          {sourceIcons[m.source] ?? '📂'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-medium text-foreground truncate block group-hover:text-primary transition-colors">
                            {m.title}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11.5px] text-muted-foreground">{fmtDate(m.created_at)}</span>
                            {m.duration && (
                              <>
                                <span className="text-muted-foreground/40 text-[11px]">·</span>
                                <span className="text-[11.5px] text-muted-foreground">{fmt(m.duration)}</span>
                              </>
                            )}
                          </div>
                          {['transcribing', 'uploading', 'summarizing'].includes(m.status) && (
                            <Progress value={m.progress} className="h-1 mt-1.5 rounded-full" />
                          )}
                        </div>
                        <div className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full flex-shrink-0 ${sc.pill}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          {sc.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right column */}
          <div className="flex flex-col gap-4">

            {/* Sparkline */}
            <Card className="border-border shadow-none bg-card">
              <CardHeader className="px-5 pt-5 pb-2 space-y-0">
                <CardTitle className="text-[14px] font-semibold">Weekly Activity</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <Sparkline data={weeklyData} />
              </CardContent>
            </Card>

            {/* Live CTA */}
            <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-500/5 dark:to-orange-500/[0.03] p-5">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="w-4 h-4 text-red-500 animate-pulse" />
                <span className="text-[13px] font-semibold text-foreground">Live Transcription</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded-full border border-red-200 dark:border-red-500/20 uppercase tracking-wider">
                  Live
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground mb-3.5 leading-relaxed">
                Real-time transcription with AI copilot. Every word, every decision captured.
              </p>
              <Button
                onClick={() => onNavigate('live')}
                size="sm"
                className="w-full gap-2 bg-red-500 hover:bg-red-600 text-white border-0 shadow-sm shadow-red-500/20"
              >
                <Radio className="w-3.5 h-3.5" />
                Start Live Session
              </Button>
            </div>

            {/* Quick upload */}
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/20 bg-gradient-to-br from-indigo-50 to-violet-50/50 dark:from-indigo-500/5 dark:to-violet-500/[0.03] p-5">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-indigo-500" />
                <span className="text-[13px] font-semibold text-foreground">Quick Upload</span>
              </div>
              <p className="text-[12px] text-muted-foreground mb-3.5 leading-relaxed">
                Drop any Zoom, Meet, or voice recording — processed in minutes.
              </p>
              <Button
                onClick={() => onNavigate('upload')}
                size="sm"
                variant="outline"
                className="w-full gap-2 border-indigo-200 dark:border-indigo-500/25 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Recording
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { BarChart2, Clock, FileText, CheckSquare, TrendingUp, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { NavPage } from '../types';

interface AnalyticsPageProps { onNavigate: (page: NavPage) => void }

interface WeekRow      { week: string; meetings: number }
interface SpeakerRow  { speaker: string; minutes: number; pct: number; fill: string }
interface StatusRow   { name: string; value: number; fill: string }
interface SourceRow   { name: string; value: number; fill: string }
interface SentimentRow { week: string; positive: number; negative: number; neutral: number }

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', in_progress: '#6366f1', complete: '#10b981',
};
const SENTIMENT_COLORS = { positive: '#10b981', negative: '#ef4444', neutral: '#94a3b8' };

function StatCard({ icon: Icon, label, value, sub, color = 'text-primary' }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] text-muted-foreground">{label}</p>
        <p className="text-[22px] font-bold text-foreground leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <h3 className="text-[13px] font-semibold text-foreground mb-4">{title}</h3>
      {children}
    </div>
  );
}

function SentimentChart({ data }: { data: SentimentRow[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; week: string; positive: number; negative: number; neutral: number } | null>(null);

  if (data.length === 0) return null;

  const W = 400, H = 150, PL = 30, PR = 8, PT = 8, PB = 28;
  const innerW = W - PL - PR;
  const innerH = H - PT - PB;

  const allVals = data.flatMap(d => [d.positive, d.negative, d.neutral]);
  const maxVal = Math.max(...allVals, 1);

  const xStep = innerW / Math.max(data.length - 1, 1);

  function pts(key: 'positive' | 'negative' | 'neutral') {
    return data.map((d, i) => {
      const x = PL + i * xStep;
      const y = PT + innerH - (d[key] / maxVal) * innerH;
      return `${x},${y}`;
    }).join(' ');
  }

  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 180 }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Grid lines */}
        {yTicks.map(tick => {
          const y = PT + innerH - (tick / maxVal) * innerH;
          return (
            <g key={tick}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
              <text x={PL - 4} y={y + 3.5} fontSize={9} fill="var(--muted-foreground)" textAnchor="end">{tick}</text>
            </g>
          );
        })}

        {/* X axis labels */}
        {data.map((d, i) => (
          <text key={i} x={PL + i * xStep} y={H - 4} fontSize={9} fill="var(--muted-foreground)" textAnchor="middle">
            {d.week}
          </text>
        ))}

        {/* Lines */}
        {(['positive', 'negative', 'neutral'] as const).map(key => (
          <polyline
            key={key}
            points={pts(key)}
            fill="none"
            stroke={SENTIMENT_COLORS[key]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Hover zones */}
        {data.map((d, i) => (
          <rect
            key={i}
            x={PL + i * xStep - xStep / 2}
            y={0}
            width={xStep}
            height={H}
            fill="transparent"
            onMouseEnter={e => {
              const svg = svgRef.current;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              const scaleX = rect.width / W;
              const scaleY = rect.height / H;
              setTooltip({
                x: (PL + i * xStep) * scaleX,
                y: (PT + innerH - (Math.max(d.positive, d.negative, d.neutral) / maxVal) * innerH) * scaleY - 40,
                week: d.week, positive: d.positive, negative: d.negative, neutral: d.neutral,
              });
            }}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-card border border-border rounded-lg px-2.5 py-2 shadow-md text-[11px] -translate-x-1/2"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-semibold text-foreground mb-1">{tooltip.week}</p>
          {(['positive', 'negative', 'neutral'] as const).map(k => (
            <div key={k} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: SENTIMENT_COLORS[k] }} />
              <span className="capitalize text-muted-foreground">{k}:</span>
              <span className="font-medium text-foreground">{tooltip[k]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-1">
        {(['positive', 'negative', 'neutral'] as const).map(k => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded-full" style={{ background: SENTIMENT_COLORS[k] }} />
            <span className="text-[11px] text-muted-foreground capitalize">{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonutChart({ data }: { data: SourceRow[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; value: number; pct: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const CX = 80, CY = 80, R = 60, r = 36;

  let angle = -Math.PI / 2;
  const slices = data.map(d => {
    const sweep = (d.value / total) * 2 * Math.PI;
    const a0 = angle, a1 = angle + sweep;
    angle = a1;
    return { ...d, a0, a1, mid: (a0 + a1) / 2 };
  });

  function arc(a0: number, a1: number, outerR: number, innerR: number) {
    const x1 = CX + outerR * Math.cos(a0), y1 = CY + outerR * Math.sin(a0);
    const x2 = CX + outerR * Math.cos(a1), y2 = CY + outerR * Math.sin(a1);
    const x3 = CX + innerR * Math.cos(a1), y3 = CY + innerR * Math.sin(a1);
    const x4 = CX + innerR * Math.cos(a0), y4 = CY + innerR * Math.sin(a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4} Z`;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-shrink-0" style={{ width: 160, height: 160 }}>
        <svg
          ref={svgRef}
          viewBox="0 0 160 160"
          className="w-full h-full"
          onMouseLeave={() => setTooltip(null)}
        >
          {slices.map((s, i) => (
            <path
              key={i}
              d={arc(s.a0, s.a1, R, r)}
              fill={s.fill}
              stroke="var(--card)"
              strokeWidth={2}
              onMouseEnter={e => {
                const svg = svgRef.current;
                if (!svg) return;
                const rect = svg.getBoundingClientRect();
                const mx = CX + (R + 8) * Math.cos(s.mid);
                const my = CY + (R + 8) * Math.sin(s.mid);
                setTooltip({
                  x: mx / 160 * rect.width,
                  y: my / 160 * rect.height,
                  name: s.name,
                  value: s.value,
                  pct: Math.round((s.value / total) * 100),
                });
              }}
            />
          ))}
          <text x={CX} y={CY - 5} textAnchor="middle" fontSize={18} fontWeight={700} fill="var(--foreground)">{total}</text>
          <text x={CX} y={CY + 12} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">meetings</text>
        </svg>

        {tooltip && (
          <div
            className="absolute pointer-events-none bg-card border border-border rounded-lg px-2 py-1.5 shadow-md text-[11px] -translate-x-1/2 -translate-y-full"
            style={{ left: tooltip.x, top: tooltip.y - 4 }}
          >
            <p className="font-semibold text-foreground">{tooltip.name}</p>
            <p className="text-muted-foreground">{tooltip.value} ({tooltip.pct}%)</p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {data.map((d, i) => {
          const pct = Math.round((d.value / total) * 100);
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.fill }} />
              <span className="text-[12px] text-foreground flex-1 truncate capitalize">{d.name}</span>
              <span className="text-[11px] text-muted-foreground flex-shrink-0">{d.value} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AnalyticsPage({ onNavigate }: AnalyticsPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [weekData, setWeekData]           = useState<WeekRow[]>([]);
  const [speakerData, setSpeakerData]     = useState<SpeakerRow[]>([]);
  const [statusData, setStatusData]       = useState<StatusRow[]>([]);
  const [sourceData, setSourceData]       = useState<SourceRow[]>([]);
  const [sentimentData, setSentimentData] = useState<SentimentRow[]>([]);
  const [stats, setStats]                 = useState({ total: 0, totalMinutes: 0, actionItems: 0, completionPct: 0 });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const since90 = new Date(Date.now() - 90 * 864e5).toISOString();

      const [meetingsRes, chunksRes, itemsRes, eventsRes] = await Promise.all([
        supabase.from('meetings').select('id, created_at, duration, status, source').gte('created_at', since90).order('created_at'),
        supabase.from('transcript_chunks').select('speaker, timestamp_start, timestamp_end, meeting_id').gte('created_at', since90).limit(5000),
        supabase.from('action_items').select('id, status').gte('created_at', since90),
        supabase.from('ai_events').select('type, created_at').gte('created_at', since90).limit(2000),
      ]);

      if (meetingsRes.error) throw meetingsRes.error;
      const meetings = meetingsRes.data ?? [];
      const chunks   = chunksRes.data ?? [];
      const items    = itemsRes.data ?? [];
      const events   = eventsRes.data ?? [];

      // ── Meetings per week ────────────────────────────────────────────────────
      const weekMap: Record<string, number> = {};
      meetings.forEach(m => {
        const d = new Date(m.created_at);
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        const label = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        weekMap[label] = (weekMap[label] ?? 0) + 1;
      });
      setWeekData(Object.entries(weekMap).slice(-12).map(([week, meetings]) => ({ week, meetings })));

      // ── Source breakdown ─────────────────────────────────────────────────────
      const sourceMap: Record<string, number> = {};
      meetings.forEach(m => { const s = m.source ?? 'upload'; sourceMap[s] = (sourceMap[s] ?? 0) + 1; });
      setSourceData(Object.entries(sourceMap).map(([name, value], i) => ({ name, value, fill: COLORS[i % COLORS.length] })));

      // ── Talk time by speaker ─────────────────────────────────────────────────
      const speakerSec: Record<string, number> = {};
      chunks.forEach(c => {
        const dur = ((c.timestamp_end ?? c.timestamp_start) - c.timestamp_start);
        if (dur > 0 && dur < 3600) speakerSec[c.speaker ?? 'Unknown'] = (speakerSec[c.speaker ?? 'Unknown'] ?? 0) + dur;
      });
      const totalSec = Object.values(speakerSec).reduce((a, b) => a + b, 0) || 1;
      const speakers = Object.entries(speakerSec)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([speaker, sec], i) => ({
          speaker: speaker.length > 14 ? speaker.slice(0, 14) + '…' : speaker,
          minutes: Math.round(sec / 60),
          pct: Math.round((sec / totalSec) * 100),
          fill: COLORS[i % COLORS.length],
        }));
      setSpeakerData(speakers);

      // ── Action item status ───────────────────────────────────────────────────
      const statusMap: Record<string, number> = { pending: 0, in_progress: 0, complete: 0 };
      items.forEach(i => { statusMap[i.status] = (statusMap[i.status] ?? 0) + 1; });
      setStatusData([
        { name: 'Pending',     value: statusMap.pending,     fill: STATUS_COLORS.pending },
        { name: 'In Progress', value: statusMap.in_progress, fill: STATUS_COLORS.in_progress },
        { name: 'Complete',    value: statusMap.complete,    fill: STATUS_COLORS.complete },
      ].filter(d => d.value > 0));

      // ── Sentiment trend by week ──────────────────────────────────────────────
      const sentMap: Record<string, { positive: number; negative: number; neutral: number }> = {};
      events.filter(e => ['positive', 'negative', 'neutral'].includes(e.type ?? '')).forEach(e => {
        const d = new Date(e.created_at);
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        const label = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (!sentMap[label]) sentMap[label] = { positive: 0, negative: 0, neutral: 0 };
        if (e.type === 'positive') sentMap[label].positive++;
        else if (e.type === 'negative') sentMap[label].negative++;
        else sentMap[label].neutral++;
      });
      setSentimentData(Object.entries(sentMap).slice(-8).map(([week, v]) => ({ week, ...v })));

      // ── Summary stats ────────────────────────────────────────────────────────
      const totalMinutes = Math.round(meetings.reduce((s, m) => s + (m.duration ?? 0), 0) / 60);
      const completed = items.filter(i => i.status === 'complete').length;
      const completionPct = items.length > 0 ? Math.round((completed / items.length) * 100) : 0;
      setStats({ total: meetings.length, totalMinutes, actionItems: items.length, completionPct });

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-[13px]">Loading analytics…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-[13px] text-destructive">{error}</p>
        <button onClick={load} className="text-[12px] text-primary underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="px-4 sm:px-6 py-4 max-w-[1100px] mx-auto w-full">
          <h1 className="text-[17px] font-semibold text-foreground">Analytics</h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">Last 90 days · {stats.total} meetings</p>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-[1100px] mx-auto w-full flex flex-col gap-5">

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={FileText}    label="Total Meetings"   value={stats.total}              color="text-indigo-500" />
          <StatCard icon={Clock}       label="Total Talk Time"  value={`${stats.totalMinutes}m`} sub="across all meetings" color="text-blue-500" />
          <StatCard icon={CheckSquare} label="Action Items"     value={stats.actionItems}        color="text-amber-500" />
          <StatCard icon={TrendingUp}  label="Completion Rate"  value={`${stats.completionPct}%`} sub="of action items done" color="text-emerald-500" />
        </div>

        {/* Meetings per week — custom HTML bars */}
        {weekData.length > 0 && (
          <ChartCard title="Meetings per Week">
            {(() => {
              const maxVal = Math.max(...weekData.map(w => w.meetings), 1);
              return (
                <div className="flex items-end gap-1 h-[160px]">
                  {weekData.map(d => (
                    <div key={d.week} className="flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-end">
                      <span className="text-[9px] text-muted-foreground">{d.meetings}</span>
                      <div
                        className="w-full rounded-t bg-indigo-500 transition-all"
                        style={{ height: `${Math.round((d.meetings / maxVal) * 120)}px` }}
                        title={`${d.week}: ${d.meetings} meeting${d.meetings !== 1 ? 's' : ''}`}
                      />
                      <span className="text-[8px] text-muted-foreground truncate w-full text-center leading-tight">{d.week}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </ChartCard>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Talk time by speaker — custom horizontal progress bars */}
          {speakerData.length > 0 && (
            <ChartCard title="Talk Time by Speaker">
              {(() => {
                const maxMin = Math.max(...speakerData.map(d => d.minutes), 1);
                return (
                  <div className="flex flex-col gap-3">
                    {speakerData.map((d, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11.5px]">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.fill }} />
                            <span className="text-foreground truncate">{d.speaker}</span>
                          </div>
                          <span className="text-muted-foreground flex-shrink-0 ml-2">{d.minutes}m ({d.pct}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${(d.minutes / maxMin) * 100}%`, background: d.fill }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </ChartCard>
          )}

          {/* Action item status — custom progress bars */}
          {statusData.length > 0 && (
            <ChartCard title="Action Item Status">
              {(() => {
                const total = statusData.reduce((s, d) => s + d.value, 0) || 1;
                return (
                  <div className="flex flex-col gap-4 pt-1">
                    {statusData.map(d => {
                      const pct = Math.round((d.value / total) * 100);
                      return (
                        <div key={d.name} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-[12px]">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.fill }} />
                              <span className="text-foreground">{d.name}</span>
                            </div>
                            <span className="font-semibold text-foreground">
                              {d.value} <span className="font-normal text-muted-foreground">({pct}%)</span>
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: d.fill }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </ChartCard>
          )}

          {/* Meeting sources — custom donut chart */}
          {sourceData.length > 0 && (
            <ChartCard title="Meeting Sources">
              <DonutChart data={sourceData} />
            </ChartCard>
          )}

          {/* Sentiment trend — custom SVG line chart */}
          {sentimentData.length > 0 && (
            <ChartCard title="Meeting Sentiment Trend">
              <SentimentChart data={sentimentData} />
            </ChartCard>
          )}
        </div>

        {/* Empty state */}
        {weekData.length === 0 && speakerData.length === 0 && statusData.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <BarChart2 className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <div>
              <p className="text-[14px] font-medium text-foreground">No data yet</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">Analytics will appear once you have meetings with transcripts.</p>
            </div>
            <button onClick={() => onNavigate('upload')} className="text-[12.5px] text-primary underline hover:no-underline">Upload your first meeting</button>
          </div>
        )}
      </div>
    </div>
  );
}

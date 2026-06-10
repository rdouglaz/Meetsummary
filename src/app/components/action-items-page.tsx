import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Search, Download, ExternalLink, Calendar, User, Loader2, ChevronDown } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { fetchAllActionItems, updateActionItemStatus } from '../../services/meetings';
import { exportToCSV, exportToNotion, exportToClickUp, exportToGoogleSheets } from '../../lib/exports';
import { supabase } from '../../lib/supabase';
import { NavPage } from '../types';
import type { Database } from '../../lib/database.types';

type ActionItemRow = Database['public']['Tables']['action_items']['Row'] & { meetings?: { title: string } | null };
type StatusType = 'pending' | 'in_progress' | 'complete';

const statusConfig: Record<StatusType, { label: string; pill: string; dot: string }> = {
  pending:     { label: 'Pending',     pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-400',   dot: 'bg-amber-500'   },
  in_progress: { label: 'In Progress', pill: 'bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-400',       dot: 'bg-blue-500'    },
  complete:    { label: 'Done',        pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-400', dot: 'bg-emerald-500' },
};

function ActionItemRow({ item, onStatusChange, onOpenMeeting }: {
  item: ActionItemRow;
  onStatusChange: (id: string, s: StatusType) => void;
  onOpenMeeting: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos]   = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cfg = statusConfig[item.status as StatusType] ?? statusConfig.pending;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.right - 144 });
    }
    setMenuOpen(v => !v);
  };

  return (
    <div className="flex items-start gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">

      {/* Checkbox toggle */}
      <button
        onClick={() => {
          const next: Record<StatusType, StatusType> = { pending: 'in_progress', in_progress: 'complete', complete: 'pending' };
          onStatusChange(item.id, next[item.status as StatusType]);
        }}
        className={`
          w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center mt-0.5
          flex-shrink-0 transition-all
          ${item.status === 'complete'    ? 'bg-emerald-500 border-emerald-500' :
            item.status === 'in_progress' ? 'border-blue-500 bg-blue-500/10'   :
                                            'border-border bg-card hover:border-primary'}
        `}
      >
        {item.status === 'complete' && (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 4l2.5 2.5L7 1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] text-foreground leading-snug ${item.status === 'complete' ? 'line-through text-muted-foreground' : ''}`}>
          {item.task}
        </p>
        <div className="flex items-center gap-2 sm:gap-3 mt-1.5 flex-wrap">
          {item.owner && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <User className="w-3 h-3" />{item.owner}
            </div>
          )}
          {item.due_date && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="w-3 h-3" />Due {item.due_date}
            </div>
          )}
          {item.meetings?.title && (
            <button
              onClick={onOpenMeeting}
              className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 truncate max-w-[160px] sm:max-w-[200px]"
            >
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{item.meetings.title}</span>
            </button>
          )}
        </div>
      </div>

      {/* Status dropdown */}
      <div className="flex-shrink-0">
        <button
          ref={triggerRef}
          onClick={openMenu}
          className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${cfg.pill}`}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          <span className="hidden sm:inline">{cfg.label}</span>
          <ChevronDown className="w-3 h-3" />
        </button>

        {menuOpen && createPortal(
          <div
            style={{ top: menuPos.top, left: menuPos.left }}
            className="fixed w-36 bg-popover border border-border rounded-xl shadow-lg z-[200] py-1 overflow-hidden"
          >
            {(['pending', 'in_progress', 'complete'] as StatusType[]).map(s => (
              <button
                key={s}
                onClick={() => { onStatusChange(item.id, s); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2.5 text-[12px] text-foreground hover:bg-muted transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${statusConfig[s].dot}`} />
                {statusConfig[s].label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

interface ActionItemsPageProps {
  onNavigate: (page: NavPage, id?: string) => void;
}

export function ActionItemsPage({ onNavigate }: ActionItemsPageProps) {
  const [items, setItems]       = useState<ActionItemRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState<'all' | StatusType>('all');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchAllActionItems()
      .then(data => setItems(data as ActionItemRow[]))
      .catch(console.error)
      .finally(() => setLoading(false));

    const channel = supabase
      .channel('action_items_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_items' }, () => {
        fetchAllActionItems().then(data => setItems(data as ActionItemRow[])).catch(console.error);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleStatusChange = async (id: string, status: StatusType) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
    await updateActionItemStatus(id, status);
  };

  const handleExport = async (type: 'csv' | 'notion' | 'clickup' | 'sheets') => {
    setExporting(true);
    const exportItems = filtered.map(i => ({ task: i.task, owner: i.owner, dueDate: i.due_date, status: i.status }));
    const title = 'MeetSummary Action Items';
    try {
      if (type === 'csv')     exportToCSV(exportItems, title);
      if (type === 'notion')  await exportToNotion(exportItems, title);
      if (type === 'clickup') await exportToClickUp(exportItems, title);
      if (type === 'sheets')  await exportToGoogleSheets(exportItems, title);
    } finally { setExporting(false); }
  };

  const filtered = items.filter(item => {
    const matchSearch = item.task.toLowerCase().includes(search.toLowerCase()) ||
      (item.owner ?? '').toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || item.status === filter;
    return matchSearch && matchFilter;
  });

  const counts = {
    all:         items.length,
    pending:     items.filter(i => i.status === 'pending').length,
    in_progress: items.filter(i => i.status === 'in_progress').length,
    complete:    items.filter(i => i.status === 'complete').length,
  };

  return (
    <div className="flex flex-col min-h-full">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="px-4 sm:px-6 py-4 max-w-[960px] mx-auto w-full flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-foreground">Action Items</h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5 hidden sm:block">
              {loading ? '…' : `${counts.pending} pending · ${counts.complete} completed`}
            </p>
          </div>
          {/* Export buttons */}
          <div className="flex items-center gap-1.5">
            {exporting && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {[
              { label: 'CSV',    type: 'csv'     as const },
              { label: 'Notion', type: 'notion'  as const },
              { label: 'Sheets', type: 'sheets'  as const },
            ].map(exp => (
              <Button
                key={exp.type}
                variant="outline"
                size="sm"
                className="text-[11px] h-8 px-2 gap-1 hidden sm:flex"
                onClick={() => handleExport(exp.type)}
                disabled={exporting || filtered.length === 0}
              >
                <Download className="w-3 h-3" />
                {exp.label}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="text-[11px] h-8 px-2 gap-1 sm:hidden"
              onClick={() => handleExport('csv')}
              disabled={exporting || filtered.length === 0}
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-[960px] mx-auto w-full flex flex-col gap-4">

        {/* Stat cards — 2-col mobile, 4-col desktop */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',       value: counts.all,         color: 'text-foreground',                    bg: 'bg-muted'                         },
            { label: 'Pending',     value: counts.pending,     color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10'  },
            { label: 'In Progress', value: counts.in_progress, color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-500/10'    },
            { label: 'Completed',   value: counts.complete,    color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
          ].map(stat => (
            <Card key={stat.label} className="border-border shadow-none bg-card">
              <CardContent className="px-4 py-3.5">
                {loading
                  ? <Skeleton className="h-7 w-8 mb-1" />
                  : <div className={`text-[24px] font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
                }
                <div className="text-[11.5px] text-muted-foreground mt-0.5">{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search + filter row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search tasks…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg self-start sm:self-auto overflow-x-auto">
            {(['all', 'pending', 'in_progress', 'complete'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md text-[11.5px] font-medium transition-all whitespace-nowrap ${
                  filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                <span className="ml-1 text-[10px] opacity-60">({counts[f]})</span>
              </button>
            ))}
          </div>
          {/* Mobile extra exports */}
          <div className="sm:hidden flex items-center gap-1 self-start">
            {(['notion', 'clickup', 'sheets'] as const).map(t => (
              <Button key={t} variant="outline" size="sm" className="text-[11px] h-8 px-2 gap-1 capitalize"
                onClick={() => handleExport(t)} disabled={exporting || filtered.length === 0}>
                <Download className="w-3 h-3" />{t.charAt(0).toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Task list */}
        <Card className="border-border shadow-none overflow-hidden bg-card">
          <div className="hidden sm:flex items-center gap-4 px-5 py-2.5 bg-muted/20 border-b border-border">
            <div className="w-[18px] flex-shrink-0" />
            <div className="flex-1 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">Task</div>
            <div className="w-[110px] text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">Status</div>
          </div>

          {loading ? (
            <div className="divide-y divide-border">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="w-[18px] h-[18px] rounded-full flex-shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                <CheckSquare className="w-5 h-5 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-[14px] font-medium text-foreground">
                  {items.length === 0 ? 'No action items yet' : 'No tasks match your filter'}
                </p>
                <p className="text-[12.5px] text-muted-foreground mt-0.5">
                  {items.length === 0 ? 'Action items will appear after your first meeting is processed' : 'Try a different filter or search'}
                </p>
              </div>
            </div>
          ) : (
            filtered.map(item => (
              <ActionItemRow
                key={item.id}
                item={item}
                onStatusChange={handleStatusChange}
                onOpenMeeting={() => item.meeting_id && onNavigate('meeting-detail', item.meeting_id)}
              />
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

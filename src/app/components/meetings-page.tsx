import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Search, Upload, Calendar, Clock, MoreHorizontal, FileText, Trash2, Share2, Loader2, AlertTriangle, X } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Progress } from './ui/progress';
import { Skeleton } from './ui/skeleton';
import { fetchMeetings } from '../../services/meetings';
import { supabase } from '../../lib/supabase';
import { deleteR2Object, isR2Key } from '../../lib/r2-client';
import { NavPage } from '../types';
import type { Database } from '../../lib/database.types';

type MeetingRow = Database['public']['Tables']['meetings']['Row'];

const sourceIcons: Record<string, string> = {
  zoom: '🎥', meet: '📹', whatsapp: '💬', phone: '📱', upload: '📂', browser: '🎙️', teams: '💼',
};
const statusConfig: Record<string, { label: string; pill: string; dot: string }> = {
  complete:     { label: 'Complete',     pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-400', dot: 'bg-emerald-500' },
  transcribing: { label: 'Transcribing', pill: 'bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-400',             dot: 'bg-blue-500'   },
  summarizing:  { label: 'Summarizing',  pill: 'bg-violet-50 text-violet-700 dark:bg-violet-500/12 dark:text-violet-400',     dot: 'bg-violet-500' },
  uploading:    { label: 'Uploading',    pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-400',         dot: 'bg-amber-500'  },
  error:        { label: 'Error',        pill: 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-400',                 dot: 'bg-red-500'    },
};

function fmt(s?: number | null) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtSize(b?: number | null) {
  if (!b) return '';
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function MeetingCard({ meeting, onOpen, onDelete }: { meeting: MeetingRow; onOpen: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen]       = useState(false);
  const [menuPos, setMenuPos]         = useState({ top: 0, left: 0 });
  const [deleting, setDeleting]       = useState(false);
  const [confirmDelete, setConfirm]   = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const sc = statusConfig[meeting.status] ?? { label: meeting.status, pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' };

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
    }
    setMenuOpen(v => !v);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setMenuOpen(false);
    setConfirm(false);
    try {
      if (meeting.file_url) {
        if (isR2Key(meeting.file_url)) {
          await deleteR2Object(meeting.file_url).catch(() => {});
        } else {
          const url = new URL(meeting.file_url);
          const pathParts = url.pathname.split('/recordings/');
          if (pathParts.length === 2) {
            await supabase.storage.from('recordings').remove([pathParts[1]]).catch(() => {});
          }
        }
      }
      await supabase.from('meetings').delete().eq('id', meeting.id);
      onDelete();
      toast.success('Meeting deleted');
    } catch {
      setDeleting(false);
      toast.error('Failed to delete meeting');
    }
  };

  const handleShare = () => {
    const url = `${window.location.origin}${window.location.pathname}?meeting=${meeting.id}`;
    navigator.clipboard.writeText(url)
      .then(() => { setMenuOpen(false); toast.success('Link copied to clipboard'); })
      .catch(() => toast.error('Could not copy link'));
  };

  const menuItems = [
    { icon: FileText, label: 'View Summary', action: () => { setMenuOpen(false); onOpen(); },  danger: false },
    { icon: Share2,   label: 'Share Link',   action: handleShare,                              danger: false },
    { icon: Trash2,   label: 'Delete',       action: () => setConfirm(true),                   danger: true  },
  ];

  return (
    <div
      className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-muted/30 transition-colors cursor-pointer group border-b border-border last:border-0"
      onClick={onOpen}
    >
      {/* Icon */}
      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-muted flex items-center justify-center text-[17px] sm:text-[18px] flex-shrink-0">
        {deleting ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (sourceIcons[meeting.source] ?? '📂')}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13.5px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
            {meeting.title}
          </span>
          {(meeting.tags ?? []).map((tag: string) => (
            <span key={tag} className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
          <span className="text-[11.5px] text-muted-foreground flex items-center gap-1">
            <Calendar className="w-3 h-3" />{fmtDate(meeting.created_at)}
          </span>
          {meeting.duration && (
            <span className="text-[11.5px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />{fmt(meeting.duration)}
            </span>
          )}
          {fmtSize(meeting.file_size) && (
            <span className="hidden sm:inline text-[11.5px] text-muted-foreground">{fmtSize(meeting.file_size)}</span>
          )}
        </div>
        {['transcribing', 'uploading', 'summarizing'].includes(meeting.status) && (
          <Progress value={meeting.progress} className="h-1 mt-1.5 max-w-[240px]" />
        )}
      </div>

      {/* Status pill */}
      <div className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full flex-shrink-0 ${sc.pill}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
        <span className="hidden sm:inline">{sc.label}</span>
      </div>

      {/* Actions menu button */}
      <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
        <button
          ref={btnRef}
          onClick={openMenu}
          disabled={deleting}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all disabled:opacity-30"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Portal dropdown — renders outside overflow-hidden ancestors */}
      {menuOpen && createPortal(
        <div
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed w-44 bg-popover border border-border rounded-xl shadow-lg z-[200] py-1 overflow-hidden"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          {confirmDelete ? (
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                <p className="text-[12px] font-semibold text-destructive">Delete this meeting?</p>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2.5 leading-relaxed">This removes the recording, transcript, and summary. Cannot be undone.</p>
              <div className="flex gap-1.5">
                <button
                  onClick={handleDelete}
                  className="flex-1 py-1.5 rounded-lg bg-destructive text-white text-[11px] font-semibold hover:bg-destructive/90 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirm(false)}
                  className="flex-1 py-1.5 rounded-lg bg-muted text-foreground text-[11px] font-medium hover:bg-muted/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            menuItems.map(item => (
              <button
                key={item.label}
                onClick={item.action}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] hover:bg-muted transition-colors ${item.danger ? 'text-destructive' : 'text-foreground'}`}
              >
                <item.icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            ))
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

interface MeetingsPageProps {
  onNavigate: (page: NavPage, id?: string) => void;
}

export function MeetingsPage({ onNavigate }: MeetingsPageProps) {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState<'all' | 'complete' | 'processing'>('all');

  useEffect(() => {
    // Recover meetings orphaned by a browser crash or forced navigation.
    // 2-hour threshold avoids flagging any real in-progress session as error.
    const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    supabase
      .from('meetings')
      .update({ status: 'error', progress: 0 })
      .in('status', ['transcribing', 'summarizing', 'uploading'])
      .lt('updated_at', staleThreshold)
      .then(() => {});

    fetchMeetings()
      .then(setMeetings)
      .catch(console.error)
      .finally(() => setLoading(false));

    const channel = supabase
      .channel('meetings_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => {
        fetchMeetings().then(setMeetings).catch(console.error);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = meetings.filter(m => {
    const matchSearch = m.title.toLowerCase().includes(search.toLowerCase()) ||
      (m.tags ?? []).some((t: string) => t.toLowerCase().includes(search.toLowerCase()));
    const matchFilter = filter === 'all' ? true : filter === 'complete' ? m.status === 'complete' : m.status !== 'complete';
    return matchSearch && matchFilter;
  });

  return (
    <div className="flex flex-col min-h-full">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="px-4 sm:px-6 py-4 max-w-[1040px] mx-auto w-full flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-foreground">Meetings</h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5 hidden sm:block">
              {loading ? '…' : `${meetings.length} recording${meetings.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <Button onClick={() => onNavigate('upload')} size="sm" className="gap-1.5 h-8 px-3">
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Upload</span>
          </Button>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-[1040px] mx-auto w-full flex flex-col gap-4">

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search meetings…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg self-start sm:self-auto">
            {(['all', 'complete', 'processing'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium capitalize transition-all whitespace-nowrap ${
                  filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <Card className="border-border shadow-none overflow-hidden bg-card">
          {/* Table header — desktop only, stays pinned */}
          <div className="hidden sm:flex items-center gap-4 px-5 py-2.5 border-b border-border bg-muted/20">
            <div className="w-10 flex-shrink-0" />
            <div className="flex-1 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">Recording</div>
            <div className="w-[110px] text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">Status</div>
            <div className="w-8" />
          </div>

          {/* Scrollable list body */}
          <div className="overflow-y-auto max-h-[calc(100vh-280px)]">
            {loading ? (
              <div className="divide-y divide-border">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
                    <div className="flex-1 flex flex-col gap-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                  <FileText className="w-5 h-5 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-[14px] font-medium text-foreground">
                    {meetings.length === 0 ? 'No recordings yet' : 'No meetings match your search'}
                  </p>
                  <p className="text-[12.5px] text-muted-foreground mt-0.5">
                    {meetings.length === 0 ? 'Upload a meeting recording to get started' : 'Try a different search or filter'}
                  </p>
                </div>
                {meetings.length === 0 && (
                  <Button variant="outline" size="sm" onClick={() => onNavigate('upload')}>
                    Upload a meeting
                  </Button>
                )}
              </div>
            ) : (
              filtered.map(m => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  onOpen={() => onNavigate('meeting-detail', m.id)}
                  onDelete={() => setMeetings(prev => prev.filter(x => x.id !== m.id))}
                />
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

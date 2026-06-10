import { useRef } from 'react';
import { Printer } from 'lucide-react';
import type { Database } from '../../lib/database.types';

type MeetingRow    = Database['public']['Tables']['meetings']['Row'];
type SummaryRow    = Database['public']['Tables']['summaries']['Row'];
type ActionItemRow = Database['public']['Tables']['action_items']['Row'];
type ChunkRow      = Database['public']['Tables']['transcript_chunks']['Row'];

interface MeetingMinutesProps {
  meeting:     MeetingRow;
  summary:     SummaryRow | null;
  actionItems: ActionItemRow[];
  chunks:      ChunkRow[];
  speakerMap:  Record<string, string>;
}

function formatTime(s: number): string {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

const SOURCE_LABELS: Record<string, string> = {
  browser: 'Browser / Microphone',
  zoom:    'Zoom',
  meet:    'Google Meet',
  teams:   'Microsoft Teams',
  phone:   'Phone Call',
  whatsapp:'WhatsApp',
  upload:  'Uploaded Recording',
};

export function MeetingMinutes({ meeting, summary, actionItems, chunks, speakerMap }: MeetingMinutesProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const overview   = (summary?.overview ?? {}) as Record<string, unknown>;
  const date       = (overview.date as string) ?? meeting.created_at;
  const participants = (overview.participants as string[] | undefined) ?? [];
  const mainPurpose  = (overview.mainPurpose as string | undefined) ?? '';
  const agendaItems  = meeting.agenda_items ?? [];
  const discussion   = summary?.key_discussion_points ?? [];
  const decisions    = summary?.key_decisions ?? [];
  const risks        = summary?.risks ?? [];

  const statusByItem = (item: ActionItemRow) =>
    item.status === 'complete' ? 'Complete' : item.status === 'in_progress' ? 'In Progress' : 'Pending';

  const exportPDF = () => {
    const prev = document.title;
    document.title = `${meeting.title} — Meeting Minutes`;
    window.print();
    document.title = prev;
  };

  return (
    <>
      {/* Print-only CSS */}
      <style>{`
        @media print {
          body > *:not([data-minutes-root]) { display: none !important; }
          [data-minutes-root] {
            display: block !important;
            position: fixed;
            inset: 0;
            z-index: 99999;
            background: white;
            color: black;
            padding: 0;
            margin: 0;
            overflow: visible;
          }
          [data-minutes-content] {
            padding: 2.5cm 2.5cm 2.5cm 2.5cm;
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #111;
          }
          [data-minutes-no-print] { display: none !important; }
          [data-minutes-section] {
            margin-top: 1.4em;
            page-break-inside: avoid;
          }
          [data-minutes-section-title] {
            font-size: 9pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.07em;
            color: #444;
            border-bottom: 1px solid #ccc;
            padding-bottom: 3pt;
            margin-bottom: 6pt;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10pt;
          }
          th, td {
            border: 1px solid #ccc;
            padding: 4pt 7pt;
            text-align: left;
            vertical-align: top;
          }
          th { background: #f5f5f5; font-weight: 700; }
          li { margin-bottom: 3pt; }
          [data-minutes-footer] {
            margin-top: 2em;
            padding-top: 0.8em;
            border-top: 1px solid #ccc;
            font-size: 9pt;
            color: #666;
          }
          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>

      {/* Screen wrapper */}
      <div ref={rootRef} data-minutes-root className="bg-background">
        {/* Screen toolbar (hidden when printing) */}
        <div data-minutes-no-print className="flex items-center justify-between px-5 py-3 border-b border-border bg-card">
          <div>
            <p className="text-[13px] font-semibold text-foreground">Meeting Minutes</p>
            <p className="text-[11px] text-muted-foreground">Formal record · ready to export</p>
          </div>
          <button
            onClick={exportPDF}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-[12px] font-semibold hover:bg-primary/90 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>

        {/* Document body */}
        <div data-minutes-content className="p-6 sm:p-8 max-w-[760px] mx-auto">

          {/* Header */}
          <div className="mb-6 pb-5 border-b border-border">
            <h1 className="text-[22px] font-bold text-foreground mb-1">{meeting.title}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground mt-2">
              <span><strong className="text-foreground">Date:</strong> {formatDate(date)}</span>
              <span><strong className="text-foreground">Duration:</strong> {formatDuration(meeting.duration)}</span>
              <span><strong className="text-foreground">Platform:</strong> {SOURCE_LABELS[meeting.source] ?? meeting.source}</span>
            </div>
            {mainPurpose && (
              <p className="text-[12.5px] text-muted-foreground mt-2 italic">{mainPurpose}</p>
            )}
          </div>

          {/* Attendees */}
          {participants.length > 0 && (
            <div data-minutes-section className="mb-5">
              <p data-minutes-section-title className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-3">
                Attendees
              </p>
              <div className="flex flex-wrap gap-2">
                {participants.map((p, i) => {
                  const name = speakerMap[p] ?? p;
                  return (
                    <span key={i} className="px-2.5 py-1 bg-muted rounded-full text-[11.5px] text-foreground">
                      {name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Agenda */}
          <div data-minutes-section className="mb-5">
            <p data-minutes-section-title className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-3">
              Agenda
            </p>
            {agendaItems.length > 0 ? (
              <ol className="list-decimal list-inside flex flex-col gap-1.5">
                {agendaItems.map((item, i) => (
                  <li key={i} className="text-[12.5px] text-foreground">{item}</li>
                ))}
              </ol>
            ) : (
              <p className="text-[12px] text-muted-foreground italic">No agenda was recorded for this meeting.</p>
            )}
          </div>

          {/* Key Discussion */}
          {discussion.length > 0 && (
            <div data-minutes-section className="mb-5">
              <p data-minutes-section-title className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-3">
                Key Discussion Points
              </p>
              <ul className="flex flex-col gap-1.5">
                {discussion.map((point, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] text-foreground">
                    <span className="text-muted-foreground flex-shrink-0 mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decisions */}
          {decisions.length > 0 && (
            <div data-minutes-section className="mb-5">
              <p data-minutes-section-title className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-3">
                Decisions Made
              </p>
              <ol className="list-decimal list-inside flex flex-col gap-1.5">
                {decisions.map((d, i) => (
                  <li key={i} className="text-[12.5px] text-foreground">{d}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Action Items */}
          {actionItems.length > 0 && (
            <div data-minutes-section className="mb-5">
              <p data-minutes-section-title className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-3">
                Action Items
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left px-3 py-2 border border-border font-semibold text-foreground">#</th>
                      <th className="text-left px-3 py-2 border border-border font-semibold text-foreground">Task</th>
                      <th className="text-left px-3 py-2 border border-border font-semibold text-foreground">Owner</th>
                      <th className="text-left px-3 py-2 border border-border font-semibold text-foreground">Due Date</th>
                      <th className="text-left px-3 py-2 border border-border font-semibold text-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionItems.map((item, i) => (
                      <tr key={item.id} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/40'}>
                        <td className="px-3 py-2 border border-border text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 border border-border text-foreground">{item.task}</td>
                        <td className="px-3 py-2 border border-border text-muted-foreground">{item.owner ?? '—'}</td>
                        <td className="px-3 py-2 border border-border text-muted-foreground">{item.due_date ?? '—'}</td>
                        <td className="px-3 py-2 border border-border text-muted-foreground">{statusByItem(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Risks */}
          {risks.length > 0 && (
            <div data-minutes-section className="mb-5">
              <p data-minutes-section-title className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-3">
                Risks &amp; Open Issues
              </p>
              <ul className="flex flex-col gap-1.5">
                {risks.map((r, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] text-foreground">
                    <span className="text-amber-500 flex-shrink-0 mt-0.5">▲</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Full Transcript */}
          {chunks.length > 0 && (
            <div data-minutes-section className="mb-5">
              <p data-minutes-section-title className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-3">
                Full Transcript
              </p>
              <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto" data-minutes-no-print>
                {chunks.map(chunk => {
                  const speaker = speakerMap[chunk.speaker ?? ''] ?? chunk.speaker ?? 'Unknown';
                  const ts      = chunk.timestamp_start != null ? formatTime(chunk.timestamp_start) : '—';
                  return (
                    <div key={chunk.id} className="flex gap-3 text-[12px]">
                      <span className="text-muted-foreground flex-shrink-0 font-mono text-[10px] mt-0.5 w-10">[{ts}]</span>
                      <span>
                        <strong className="text-foreground">{speaker}:</strong>{' '}
                        <span className="text-muted-foreground">{chunk.text}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Print-only transcript (no scroll limit) */}
              <div className="hidden" style={{ display: 'none' }}>
                {chunks.map(chunk => {
                  const speaker = speakerMap[chunk.speaker ?? ''] ?? chunk.speaker ?? 'Unknown';
                  const ts      = chunk.timestamp_start != null ? formatTime(chunk.timestamp_start) : '—';
                  return (
                    <p key={`p-${chunk.id}`} style={{ fontSize: '9pt', marginBottom: '4pt', fontFamily: 'monospace' }}>
                      [{ts}] {speaker}: {chunk.text}
                    </p>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          <div data-minutes-footer className="mt-8 pt-4 border-t border-border text-[10.5px] text-muted-foreground flex items-center justify-between">
            <span>Generated by MeetSummary · AI-assisted, human-reviewed</span>
            <span>{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </>
  );
}

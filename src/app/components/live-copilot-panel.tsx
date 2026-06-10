import { useState, useRef, useEffect } from 'react';
import {
  CheckSquare, CheckCircle2, AlertTriangle, HelpCircle, Star, Zap,
  ThumbsUp, ThumbsDown, ArrowRight, Loader2, MessageCircle, Brain,
  Send, TrendingUp, ListOrdered,
} from 'lucide-react';
import { Button } from './ui/button';
import { AIEvent, AIEventType, LiveSummaryState, ChatMessage, CoachingPrompt } from '../live-types';
import { aggregateSentiment, sentimentColor } from '../../lib/sentiment';
import type { Sentiment } from '../../lib/sentiment';

const eventConfig: Record<AIEventType, {
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
}> = {
  action_item: { label: 'Action Item', icon: CheckSquare, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/8', border: 'border-purple-500/20' },
  decision:    { label: 'Decision',    icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/20' },
  risk:        { label: 'Risk',        icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/20' },
  question:    { label: 'Open Question', icon: HelpCircle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/8', border: 'border-amber-500/20' },
  commitment:  { label: 'Commitment', icon: Zap, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/8', border: 'border-blue-500/20' },
  important:   { label: 'Key Moment', icon: Star, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/8', border: 'border-orange-500/20' },
};

const coachingStyle: Record<CoachingPrompt['type'], { color: string; bg: string; border: string; label: string }> = {
  tip:      { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', label: 'Tip' },
  caution:  { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/8', border: 'border-amber-500/20', label: 'Watch Out' },
  question: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/8', border: 'border-blue-500/20', label: 'Prompt' },
};

type CopilotTab = 'summary' | 'actions' | 'decisions' | 'risks' | 'chat' | 'coaching' | 'agenda';

interface LiveCopilotPanelProps {
  events: AIEvent[];
  summary: LiveSummaryState;
  isSummaryUpdating: boolean;
  onApprove: (eventId: string) => void;
  onDismiss: (eventId: string) => void;
  onExportToSheets: () => void;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  onSendChat: (text: string) => void;
  coachingPrompts: CoachingPrompt[];
  utteranceSentiments: Sentiment[];
  agendaItems?: string[];
}

function EventCard({ event, onApprove, onDismiss }: {
  event: AIEvent;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const cfg = eventConfig[event.type];
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border p-3 transition-all duration-200 ${cfg.bg} ${cfg.border} ${event.approved === false ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-2.5">
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.bg}`}>
          <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${cfg.color}`}>{cfg.label}</span>
          </div>
          <p className="text-[12px] text-foreground leading-snug">{event.content}</p>
          {event.owner && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                <span className="text-[8px] font-bold text-primary-foreground">{event.owner.charAt(0)}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">{event.owner}</span>
              {event.dueDate && (
                <><span className="text-[11px] text-muted-foreground">·</span>
                <span className="text-[11px] text-muted-foreground">Due {event.dueDate}</span></>
              )}
            </div>
          )}
          {event.approved === undefined && (
            <div className="flex items-center gap-2 mt-2">
              <button onClick={onApprove} className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:opacity-80 transition-opacity bg-emerald-500/10 px-2 py-1 rounded-lg">
                <ThumbsUp className="w-3 h-3" />Approve
              </button>
              <button onClick={onDismiss} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <ThumbsDown className="w-3 h-3" />Dismiss
              </button>
            </div>
          )}
          {event.approved === true && (
            <div className="flex items-center gap-1 mt-2">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Approved</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SentimentBar({ sentiments }: { sentiments: Sentiment[] }) {
  if (sentiments.length === 0) return null;
  const stats = aggregateSentiment(sentiments);
  return (
    <div className="rounded-xl border border-border p-3 bg-card">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Sentiment</span>
        <span className={`ml-auto text-[11px] font-semibold ${sentimentColor(stats.overall)}`}>
          {stats.overall.charAt(0).toUpperCase() + stats.overall.slice(1)}
        </span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {stats.positive > 0 && <div className="bg-emerald-500" style={{ width: `${stats.positive}%` }} />}
        {stats.neutral > 0 && <div className="bg-muted-foreground/30" style={{ width: `${stats.neutral}%` }} />}
        {stats.negative > 0 && <div className="bg-red-500" style={{ width: `${stats.negative}%` }} />}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
        <span className="text-emerald-600 dark:text-emerald-400">+{stats.positive}%</span>
        <span>{stats.neutral}% neutral</span>
        <span className="text-red-600 dark:text-red-400">-{stats.negative}%</span>
      </div>
    </div>
  );
}

export function LiveCopilotPanel({
  events,
  summary,
  isSummaryUpdating,
  onApprove,
  onDismiss,
  onExportToSheets,
  chatMessages,
  isChatLoading,
  onSendChat,
  coachingPrompts,
  utteranceSentiments,
  agendaItems = [],
}: LiveCopilotPanelProps) {
  const [tab, setTab] = useState<CopilotTab>('summary');
  const [chatInput, setChatInput] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const actionItems  = events.filter(e => e.type === 'action_item');
  const decisions    = events.filter(e => e.type === 'decision');
  const risks        = events.filter(e => e.type === 'risk');
  const commitments  = events.filter(e => e.type === 'commitment');
  const questions    = events.filter(e => e.type === 'question');
  const important    = events.filter(e => e.type === 'important');

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, isChatLoading]);

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || isChatLoading) return;
    setChatInput('');
    onSendChat(text);
  };

  const tabs: { id: CopilotTab; label: string; count?: number; icon?: React.ElementType }[] = [
    { id: 'summary',  label: 'Summary' },
    { id: 'actions',  label: 'Tasks', count: actionItems.length },
    { id: 'decisions',label: 'Decisions', count: decisions.length },
    { id: 'risks',    label: 'Risks', count: risks.filter(r => r.approved !== false).length },
    { id: 'agenda',   label: 'Agenda', icon: ListOrdered, count: agendaItems.length || undefined },
    { id: 'chat',     label: 'Chat', icon: MessageCircle, count: chatMessages.filter(m => m.role === 'ai').length },
    { id: 'coaching', label: 'Coach', icon: Brain, count: coachingPrompts.length },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-[13px] font-semibold text-foreground">AI Copilot</span>
          </div>
          {isSummaryUpdating && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />Updating…
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Live</span>
          </div>
        </div>

        {/* Tabs — scrollable */}
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none bg-muted p-0.5 rounded-lg">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-shrink-0 flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[10.5px] font-semibold transition-all ${
                  tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {Icon && <Icon className="w-3 h-3" />}
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`text-[9px] font-bold min-w-[14px] h-3.5 flex items-center justify-center rounded-full px-1 ${
                    tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'
                  }`}>{t.count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className={`flex-1 overflow-y-auto px-4 pb-4 ${tab === 'chat' ? 'flex flex-col' : ''}`}>

        {/* Summary */}
        {tab === 'summary' && (
          <div className="flex flex-col gap-3">
            <SentimentBar sentiments={utteranceSentiments} />
            <div className={`rounded-xl border border-border p-3 transition-all ${isSummaryUpdating ? 'border-amber-500/30 bg-amber-500/5' : 'bg-card'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Running Summary</span>
                {isSummaryUpdating && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
              </div>
              {summary.running ? (
                <p className="text-[12px] text-foreground leading-relaxed">{summary.running}</p>
              ) : (
                <p className="text-[12px] text-muted-foreground italic">Summary generates every 5 minutes or when you pause the recording.</p>
              )}
            </div>
            {commitments.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Commitments Made</p>
                <div className="flex flex-col gap-2">
                  {commitments.map(e => <EventCard key={e.id} event={e} onApprove={() => onApprove(e.id)} onDismiss={() => onDismiss(e.id)} />)}
                </div>
              </div>
            )}
            {questions.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Open Questions</p>
                <div className="flex flex-col gap-2">
                  {questions.map(e => <EventCard key={e.id} event={e} onApprove={() => onApprove(e.id)} onDismiss={() => onDismiss(e.id)} />)}
                </div>
              </div>
            )}
            {important.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Key Moments</p>
                <div className="flex flex-col gap-2">
                  {important.map(e => <EventCard key={e.id} event={e} onApprove={() => onApprove(e.id)} onDismiss={() => onDismiss(e.id)} />)}
                </div>
              </div>
            )}
            {events.length === 0 && !summary.running && (
              <div className="text-center py-8">
                <p className="text-[12px] text-muted-foreground">AI insights will appear as the meeting progresses…</p>
              </div>
            )}
          </div>
        )}

        {/* Tasks */}
        {tab === 'actions' && (
          <div className="flex flex-col gap-3">
            {actionItems.length > 0 && (
              <Button variant="outline" size="sm" onClick={onExportToSheets} className="w-full gap-2 text-[12px]">
                <ArrowRight className="w-3.5 h-3.5" />Export to Google Sheets
              </Button>
            )}
            {actionItems.length === 0 ? (
              <div className="text-center py-8">
                <CheckSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">No action items detected yet</p>
              </div>
            ) : actionItems.map(e => <EventCard key={e.id} event={e} onApprove={() => onApprove(e.id)} onDismiss={() => onDismiss(e.id)} />)}
          </div>
        )}

        {/* Decisions */}
        {tab === 'decisions' && (
          <div className="flex flex-col gap-2">
            {decisions.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">No decisions detected yet</p>
              </div>
            ) : decisions.map(e => <EventCard key={e.id} event={e} onApprove={() => onApprove(e.id)} onDismiss={() => onDismiss(e.id)} />)}
          </div>
        )}

        {/* Risks */}
        {tab === 'risks' && (
          <div className="flex flex-col gap-2">
            {risks.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">No risks detected yet</p>
              </div>
            ) : risks.map(e => <EventCard key={e.id} event={e} onApprove={() => onApprove(e.id)} onDismiss={() => onDismiss(e.id)} />)}
          </div>
        )}

        {/* Agenda */}
        {tab === 'agenda' && (
          <div className="flex flex-col gap-2">
            {agendaItems.length === 0 ? (
              <div className="text-center py-8">
                <ListOrdered className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">No agenda was set for this meeting.</p>
                <p className="text-[11px] text-muted-foreground mt-1">You can add one after the meeting from the detail view.</p>
              </div>
            ) : (
              <ol className="flex flex-col gap-2">
                {agendaItems.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="text-[12.5px] text-foreground leading-snug">{item}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* Chat */}
        {tab === 'chat' && (
          <>
            <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto min-h-0 pb-2">
              {chatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                  <MessageCircle className="w-8 h-8 text-muted-foreground/30" />
                  <p className="text-[12px] text-muted-foreground">Ask anything about the meeting so far…</p>
                </div>
              )}
              {chatMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted px-3 py-2 rounded-2xl rounded-bl-sm flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">Thinking…</span>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>
            <div className="flex-shrink-0 flex gap-2 pt-2 border-t border-border mt-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Ask about the meeting…"
                className="flex-1 px-3 py-2 rounded-xl bg-muted text-[12px] text-foreground placeholder:text-muted-foreground border border-transparent focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 transition-all"
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim() || isChatLoading}
                className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors flex-shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}

        {/* Coaching */}
        {tab === 'coaching' && (
          <div className="flex flex-col gap-2">
            {coachingPrompts.length === 0 ? (
              <div className="text-center py-8">
                <Brain className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">
                  Coaching tips appear after the first AI summary runs (5 min or on pause).
                </p>
              </div>
            ) : (
              coachingPrompts.map(p => {
                const s = coachingStyle[p.type];
                return (
                  <div key={p.id} className={`rounded-xl border p-3 ${s.bg} ${s.border}`}>
                    <span className={`text-[9.5px] font-bold uppercase tracking-wide ${s.color}`}>{s.label}</span>
                    <p className="text-[12px] text-foreground leading-snug mt-1">{p.content}</p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

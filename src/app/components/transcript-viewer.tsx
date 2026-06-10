import { useState, useEffect, useRef } from 'react';
import { Search, User } from 'lucide-react';
import { Input } from './ui/input';
import { TranscriptUtterance } from '../types';

const SPEAKER_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'Speaker 1': { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
  'Speaker 2': { bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', dot: 'bg-purple-500' },
  'Speaker 3': { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  'Speaker 4': { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
};

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface TranscriptViewerProps {
  utterances: TranscriptUtterance[];
  currentTime: number;
  onSeek: (time: number) => void;
}

export function TranscriptViewer({ utterances, currentTime, onSeek }: TranscriptViewerProps) {
  const [search, setSearch] = useState('');
  const activeRef = useRef<HTMLDivElement>(null);

  const activeUtteranceIdx = utterances.findIndex(
    u => currentTime >= u.start && currentTime <= u.end
  );

  useEffect(() => {
    if (activeRef.current && activeUtteranceIdx >= 0) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeUtteranceIdx]);

  const filteredUtterances = utterances.filter(u =>
    search === '' || u.transcript.toLowerCase().includes(search.toLowerCase())
  );

  // Pendo Track: transcript search executed (debounced)
  useEffect(() => {
    if (!search.trim()) return;
    const timer = setTimeout(() => {
      (window as any).pendo?.track('transcript_search_executed', {
        queryLength: search.length,
        resultsCount: filteredUtterances.length,
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (utterances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
          <User className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-[14px] text-muted-foreground">Transcript not yet available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search transcript…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Speaker legend */}
      <div className="flex items-center gap-3 flex-wrap">
        {Array.from(new Set(utterances.map(u => u.speaker))).map(speaker => {
          const colors = SPEAKER_COLORS[speaker] ?? { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' };
          return (
            <div key={speaker} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
              <span className="text-[12px] text-muted-foreground">{speaker}</span>
            </div>
          );
        })}
      </div>

      {/* Transcript body */}
      <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1" style={{ maxHeight: '420px' }}>
        {filteredUtterances.map((utterance, idx) => {
          const isActive = activeUtteranceIdx >= 0 && utterances[activeUtteranceIdx] === utterance;
          const colors = SPEAKER_COLORS[utterance.speaker] ?? { bg: 'bg-accent', text: 'text-muted-foreground', dot: 'bg-muted-foreground' };

          return (
            <div
              key={idx}
              ref={isActive ? activeRef : null}
              className={`rounded-xl p-3 transition-all cursor-pointer ${
                isActive ? `${colors.bg} ring-1 ring-inset ring-current/20` : 'hover:bg-accent/30'
              }`}
              onClick={() => onSeek(utterance.start)}
            >
              {/* Speaker + timestamp */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
                  <span className={`text-[12px] font-semibold ${colors.text}`}>{utterance.speaker}</span>
                </div>
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground font-mono transition-colors"
                  onClick={e => { e.stopPropagation(); onSeek(utterance.start); }}
                >
                  {formatTime(utterance.start)}
                </button>
              </div>

              {/* Words — karaoke highlight */}
              <p className="text-[13px] leading-relaxed text-foreground">
                {utterance.words.length > 0
                  ? utterance.words.map((w, wi) => {
                      const isWordActive = currentTime >= w.start && currentTime <= w.end;
                      const isWordPlayed = currentTime > w.end;
                      return (
                        <span
                          key={wi}
                          className={`inline mr-1 transition-all ${
                            isWordActive
                              ? `${colors.text} font-semibold underline underline-offset-2`
                              : isWordPlayed
                              ? 'text-foreground opacity-60'
                              : 'text-foreground'
                          }`}
                        >
                          {(() => {
                            const display = w.punctuated_word ?? w.word;
                            return search && display.toLowerCase().includes(search.toLowerCase())
                              ? <mark className="bg-yellow-300/40 rounded-sm">{display}</mark>
                              : display;
                          })()}
                        </span>
                      );
                    })
                  : utterance.transcript
                }
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { LiveUtterance } from '../live-types';
import { MiniWaveform } from './live-waveform';
import { sentimentEmoji } from '../../lib/sentiment';

const SPEAKER_STYLES: Record<string, { dot: string; name: string; bg: string; activeBg: string }> = {
  'Speaker 1': { dot: 'bg-blue-500', name: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/5', activeBg: 'bg-blue-500/10' },
  'Speaker 2': { dot: 'bg-purple-500', name: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/5', activeBg: 'bg-purple-500/10' },
  'Speaker 3': { dot: 'bg-emerald-500', name: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/5', activeBg: 'bg-emerald-500/10' },
  'Speaker 4': { dot: 'bg-amber-500', name: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/5', activeBg: 'bg-amber-500/10' },
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface LiveTranscriptPanelProps {
  utterances: LiveUtterance[];
  streamingWords: string[];
  streamingSpeaker: string;
  activeSpeaker: string;
  elapsed: number;
  isLive: boolean;
}

export function LiveTranscriptPanel({
  utterances,
  streamingWords,
  streamingSpeaker,
  activeSpeaker,
  elapsed,
  isLive,
}: LiveTranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances.length, streamingWords.length]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Transcript scroll area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1">
        {utterances.length === 0 && streamingWords.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            </div>
            <div>
              <p className="text-[14px] font-medium text-foreground">Listening…</p>
              <p className="text-[12px] text-muted-foreground mt-1">Transcript will appear here as the meeting progresses</p>
            </div>
          </div>
        )}

        {/* Finalized utterances */}
        {utterances.map((utterance, idx) => {
          const style = SPEAKER_STYLES[utterance.speaker] ?? SPEAKER_STYLES['Speaker 1'];
          const isActive = utterance.speaker === activeSpeaker && idx === utterances.length - 1;

          return (
            <div
              key={utterance.id}
              className={`group flex gap-3 px-3 py-2.5 rounded-xl transition-colors ${isActive ? style.activeBg : 'hover:bg-accent/20'}`}
            >
              {/* Speaker dot */}
              <div className="flex flex-col items-center gap-1.5 pt-0.5 flex-shrink-0">
                <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[11px] font-semibold ${style.name}`}>{utterance.speaker}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{formatElapsed(utterance.startTime)}</span>
                  {isActive && isLive && <MiniWaveform active={true} color={style.dot.replace('bg-', '#').replace('-500', '')} />}
                </div>
                <div className="flex items-start gap-1.5">
                  <p className="text-[13px] text-foreground leading-relaxed flex-1">{utterance.text}</p>
                  {utterance.sentiment && utterance.sentiment !== 'neutral' && (
                    <span className="text-[12px] flex-shrink-0 mt-0.5" title={utterance.sentiment}>{sentimentEmoji(utterance.sentiment)}</span>
                  )}
                </div>
                {utterance.translation && (
                  <p className="text-[11.5px] text-muted-foreground italic mt-1 leading-relaxed border-l-2 border-muted-foreground/20 pl-2">
                    {utterance.translation}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {/* Currently streaming utterance */}
        {streamingWords.length > 0 && streamingSpeaker && (
          <div className={`flex gap-3 px-3 py-2.5 rounded-xl ${
            (SPEAKER_STYLES[streamingSpeaker] ?? SPEAKER_STYLES['Speaker 1']).activeBg
          }`}>
            <div className="flex flex-col items-center gap-1.5 pt-0.5 flex-shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full ${(SPEAKER_STYLES[streamingSpeaker] ?? SPEAKER_STYLES['Speaker 1']).dot} animate-pulse`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[11px] font-semibold ${(SPEAKER_STYLES[streamingSpeaker] ?? SPEAKER_STYLES['Speaker 1']).name}`}>
                  {streamingSpeaker}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">{formatElapsed(elapsed)}</span>
                <MiniWaveform active={isLive} />
                <span className="text-[9px] font-semibold text-red-500 uppercase tracking-wide px-1.5 py-0.5 bg-red-500/10 rounded">live</span>
              </div>
              <p className="text-[13px] text-foreground leading-relaxed">
                {streamingWords.join(' ')}
                <span className="inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-pulse align-middle" />
              </p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Speaker legend */}
      {utterances.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-border flex items-center gap-4 flex-wrap">
          {Array.from(new Set([...utterances.map(u => u.speaker), streamingSpeaker].filter(Boolean))).map(speaker => {
            const style = SPEAKER_STYLES[speaker] ?? SPEAKER_STYLES['Speaker 1'];
            const isActive = speaker === activeSpeaker && isLive;
            return (
              <div key={speaker} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${style.dot} ${isActive ? 'animate-pulse' : ''}`} />
                <span className={`text-[11px] ${isActive ? style.name + ' font-semibold' : 'text-muted-foreground'}`}>
                  {speaker}
                  {isActive && ' (speaking)'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Lock } from 'lucide-react';
import { Slider } from './ui/slider';

interface AudioPlayerProps {
  audioUrl?: string | null;
  duration: number;
  currentTime: number;
  onTimeChange: (time: number) => void;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function WaveformCanvas({ progress, duration }: { progress: number; duration: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef   = useRef<number[]>([]);

  useEffect(() => {
    const bars = 120;
    barsRef.current = Array.from({ length: bars }, (_, i) => {
      const base     = 0.2 + Math.random() * 0.6;
      const envelope = Math.sin((i / bars) * Math.PI);
      return base * envelope + 0.1 + Math.random() * 0.15;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    const bars             = barsRef.current;
    const barW             = W / bars;
    const gap              = 1.5;
    const progressFraction = duration > 0 ? progress / duration : 0;

    bars.forEach((amp, i) => {
      const x      = i * barW + gap / 2;
      const bw     = barW - gap;
      const bh     = amp * H;
      const y      = (H - bh) / 2;
      const played = i / bars < progressFraction;

      ctx.fillStyle = played ? '#6366f1' : 'rgba(99, 102, 241, 0.2)';
      const r = Math.min(2, bw / 2, bh / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + bw - r, y);
      ctx.arcTo(x + bw, y, x + bw, y + r, r);
      ctx.lineTo(x + bw, y + bh - r);
      ctx.arcTo(x + bw, y + bh, x + bw - r, y + bh, r);
      ctx.lineTo(x + r, y + bh);
      ctx.arcTo(x, y + bh, x, y + bh - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();
    });

    const px = progressFraction * W;
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }, [progress, duration]);

  return <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />;
}

export function AudioPlayer({ audioUrl, duration, currentTime, onTimeChange }: AudioPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [volume,  setVolume]  = useState(1.0);  // 0–1 maps to 0–200% gain
  const [muted,   setMuted]   = useState(false);

  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);
  const hasAudio    = Boolean(audioUrl);

  // ── Real <audio> element setup ────────────────────────────────────────────
  useEffect(() => {
    if (!audioUrl) return;

    const audio        = new Audio(audioUrl);
    audio.preload      = 'auto';
    audio.crossOrigin  = 'anonymous';
    audioRef.current   = audio;

    // Web Audio API gain node — allows amplification beyond the 0–1 cap on
    // audio.volume, compensating for quiet mic recordings.
    const ctx  = new AudioContext();
    const src  = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = muted ? 0 : volume * 2; // 0–2x range
    src.connect(gain);
    gain.connect(ctx.destination);
    audioCtxRef.current = ctx;
    gainNodeRef.current = gain;

    const onTimeUpdate = () => onTimeChange(audio.currentTime);
    const onEnded      = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      ctx.close();
      audioRef.current  = null;
      gainNodeRef.current = null;
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // Sync volume/mute via GainNode
  useEffect(() => {
    if (!gainNodeRef.current) return;
    gainNodeRef.current.gain.value = muted ? 0 : volume * 2;
  }, [volume, muted]);

  // ── Simulation interval (no audio URL) ───────────────────────────────────
  const tick = useCallback(() => {
    onTimeChange(Math.min(currentTime + 0.25, duration));
  }, [currentTime, duration, onTimeChange]);

  useEffect(() => {
    if (hasAudio) return; // real audio handles its own time
    if (playing) {
      intervalRef.current = window.setInterval(tick, 250);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, tick, hasAudio]);

  // Stop at end (simulation only)
  useEffect(() => {
    if (!hasAudio && currentTime >= duration && duration > 0) {
      setPlaying(false);
    }
  }, [currentTime, duration, hasAudio]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const togglePlay = () => {
    const audio = audioRef.current;
    if (audio) {
      if (playing) {
        audio.pause();
      } else {
        // Browsers suspend AudioContext until a user gesture — resume it first.
        audioCtxRef.current?.resume();
        audio.play().catch(() => {});
      }
    }
    setPlaying(v => !v);
  };

  const seek = (time: number) => {
    const clamped = Math.max(0, Math.min(duration, time));
    if (audioRef.current) audioRef.current.currentTime = clamped;
    onTimeChange(clamped);
  };

  const skip = (delta: number) => seek(currentTime + delta);

  return (
    <div className="bg-card border border-border rounded-2xl px-5 py-4 flex flex-col gap-3">
      {/* No-audio notice */}
      {!hasAudio && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/60 self-start">
          <Lock className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10.5px] text-muted-foreground">
            Audio not stored · karaoke timeline only
          </span>
        </div>
      )}

      {/* Waveform — click to seek */}
      <div
        className="h-[56px] cursor-pointer rounded-lg overflow-hidden"
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - rect.left) / rect.width * duration);
        }}
      >
        <WaveformCanvas progress={currentTime} duration={duration} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => skip(-10)}
          className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-all"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={togglePlay}
          className="w-9 h-9 bg-primary rounded-full flex items-center justify-center text-primary-foreground hover:opacity-90 transition-opacity flex-shrink-0"
        >
          {playing
            ? <Pause className="w-4 h-4" />
            : <Play  className="w-4 h-4 translate-x-0.5" />}
        </button>

        <button
          onClick={() => skip(10)}
          className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-all"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <span className="text-[12px] font-mono text-muted-foreground flex-shrink-0">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex-1">
          <Slider
            value={[currentTime]}
            max={Math.max(duration, 1)}
            step={1}
            onValueChange={([v]) => seek(v)}
            className="h-1"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMuted(v => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {muted || volume === 0
              ? <VolumeX className="w-4 h-4" />
              : <Volume2 className="w-4 h-4" />}
          </button>
          {/* Slider 0–200: maps to GainNode 0–2x, default 100 = 2x amplification */}
          <div className="w-16">
            <Slider
              value={[muted ? 0 : Math.round(volume * 200)]}
              max={200}
              step={1}
              onValueChange={([v]) => { setVolume(v / 200); setMuted(false); }}
              className="h-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

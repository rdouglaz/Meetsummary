import { useEffect, useRef, useState } from 'react';

interface LiveWaveformProps {
  micStream: MediaStream | null;
  active: boolean;
  height?: number;
  color?: string;
  className?: string;
}

export function LiveWaveform({ micStream, active, height = 48, color = '#ef4444', className = '' }: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const simulatedPhase = useRef(0);

  useEffect(() => {
    if (!micStream || !active) return;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = ctx.createMediaStreamSource(micStream);
      source.connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = ctx;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // Fallback to simulated
    }
    return () => {
      audioCtxRef.current?.close();
      analyserRef.current = null;
      dataRef.current = null;
    };
  }, [micStream, active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const draw = () => {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx2d.scale(dpr, dpr);
      }

      ctx2d.clearRect(0, 0, W, H);

      if (!active) {
        // Flat line when inactive
        ctx2d.strokeStyle = `${color}30`;
        ctx2d.lineWidth = 2;
        ctx2d.beginPath();
        ctx2d.moveTo(0, H / 2);
        ctx2d.lineTo(W, H / 2);
        ctx2d.stroke();
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const BARS = 60;
      const barW = W / BARS;
      const gap = 1.5;

      let amplitudes: number[];

      if (analyserRef.current && dataRef.current) {
        // Real mic data
        analyserRef.current.getByteFrequencyData(dataRef.current);
        const step = Math.floor(dataRef.current.length / BARS);
        amplitudes = Array.from({ length: BARS }, (_, i) => {
          const v = dataRef.current![i * step] / 255;
          return Math.max(0.04, v);
        });
      } else {
        // Simulated breathing waveform
        simulatedPhase.current += 0.05;
        amplitudes = Array.from({ length: BARS }, (_, i) => {
          const base = Math.sin(simulatedPhase.current + i * 0.4) * 0.3 + 0.35;
          const noise = (Math.random() - 0.5) * 0.15;
          return Math.max(0.04, Math.min(0.95, base + noise));
        });
      }

      // Mirror waveform (top + bottom from center)
      amplitudes.forEach((amp, i) => {
        const x = i * barW + gap / 2;
        const bw = Math.max(1, barW - gap);
        const bh = amp * H;
        const y = (H - bh) / 2;

        // Gradient fill
        const grad = ctx2d.createLinearGradient(x, y, x, y + bh);
        grad.addColorStop(0, `${color}60`);
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, `${color}60`);

        ctx2d.fillStyle = grad;
        const r = Math.min(2, bw / 2);
        ctx2d.beginPath();
        ctx2d.moveTo(x + r, y);
        ctx2d.lineTo(x + bw - r, y);
        ctx2d.arcTo(x + bw, y, x + bw, y + r, r);
        ctx2d.lineTo(x + bw, y + bh - r);
        ctx2d.arcTo(x + bw, y + bh, x + bw - r, y + bh, r);
        ctx2d.lineTo(x + r, y + bh);
        ctx2d.arcTo(x, y + bh, x, y + bh - r, r);
        ctx2d.lineTo(x, y + r);
        ctx2d.arcTo(x, y, x + r, y, r);
        ctx2d.closePath();
        ctx2d.fill();
      });

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active, color]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${className}`}
      style={{ height, display: 'block' }}
    />
  );
}

// Mini inline waveform for speaker indicator
export function MiniWaveform({ active, color = '#ef4444' }: { active: boolean; color?: string }) {
  const phaseRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const W = 28;
      const H = 16;
      canvas.width = W;
      canvas.height = H;
      ctx.clearRect(0, 0, W, H);

      if (!active) {
        ctx.strokeStyle = `${color}40`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      phaseRef.current += 0.12;
      const bars = 7;
      const bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const amp = Math.abs(Math.sin(phaseRef.current + i * 0.9)) * 0.8 + 0.1;
        const bh = amp * H;
        const x = i * bw + 1;
        const y = (H - bh) / 2;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7 + amp * 0.3;
        ctx.fillRect(x, y, bw - 2, bh);
      }
      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active, color]);

  return <canvas ref={canvasRef} width={28} height={16} className="flex-shrink-0" />;
}

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, FileText, CheckSquare, Cpu } from 'lucide-react';

/* ─── Timing constants (ms) ──────────────────────────────────────────────── */
const EXIT_AT    = 4600;
const UNMOUNT_AT = 5300;

/* ─── Canvas particle network ────────────────────────────────────────────── */
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  hue: number;
}

const HUES = [185, 248, 158]; // cyan / indigo / emerald
const MAX_DIST = 140;
const COUNT   = 90;

function useParticleCanvas(ref: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // offsetWidth/offsetHeight can be 0 in sandboxed iframes before layout;
    // fall back to window dimensions so particles are always valid numbers.
    const getSize = () => ({
      W: canvas.offsetWidth  || window.innerWidth  || 800,
      H: canvas.offsetHeight || window.innerHeight || 600,
    });

    let { W, H } = getSize();
    canvas.width  = W;
    canvas.height = H;

    const pts: Particle[] = Array.from({ length: COUNT }, () => ({
      x:   Math.random() * W,
      y:   Math.random() * H,
      vx:  (Math.random() - 0.5) * 0.45,
      vy:  (Math.random() - 0.5) * 0.45,
      r:   0.8 + Math.random() * 1.8,
      hue: HUES[Math.floor(Math.random() * HUES.length)],
    }));

    const resize = () => {
      const s = getSize();
      W = s.W; H = s.H;
      canvas.width  = W;
      canvas.height = H;
    };
    window.addEventListener('resize', resize);

    const t0 = Date.now();
    let raf: number;

    const tick = () => {
      const age    = (Date.now() - t0) / 1000;
      const fadeIn = Math.min(1, age / 1.5);

      ctx.clearRect(0, 0, W, H);

      for (const p of pts) {
        p.x = (p.x + p.vx + W) % W;
        p.y = (p.y + p.vy + H) % H;
      }

      // connections
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d  = Math.hypot(dx, dy);
          if (d < MAX_DIST) {
            const a = (1 - d / MAX_DIST) * 0.55 * fadeIn;
            const h = (pts[i].hue + pts[j].hue) / 2;
            ctx.strokeStyle = `hsla(${h},80%,65%,${a})`;
            ctx.lineWidth   = 0.8;
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.stroke();
          }
        }
      }

      // dots + halos
      for (const p of pts) {
        const haloR = p.r * 5;
        // Guard: createRadialGradient throws on non-finite / zero-radius values
        if (Number.isFinite(p.x) && Number.isFinite(p.y) && haloR > 0) {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
          grd.addColorStop(0, `hsla(${p.hue},80%,70%,${0.18 * fadeIn})`);
          grd.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }
        // dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},90%,75%,${0.9 * fadeIn})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [ref]);
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function Bracket({ pos, delay }: { pos: 'tl' | 'tr' | 'bl' | 'br'; delay: number }) {
  const top  = pos.startsWith('t');
  const left = pos.endsWith('l');
  const T    = top  ? { top: 20 }    : { bottom: 20 };
  const L    = left ? { left: 20 }   : { right: 20 };
  const cy   = 'rgba(6,182,212,0.75)';

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ ...T, ...L, width: 44, height: 44 }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* horizontal arm */}
      <div style={{
        position: 'absolute',
        [top ? 'top' : 'bottom']: 0,
        [left ? 'left' : 'right']: 0,
        width: 44, height: 1.5, background: cy,
        boxShadow: `0 0 6px ${cy}`,
      }} />
      {/* vertical arm */}
      <div style={{
        position: 'absolute',
        [top ? 'top' : 'bottom']: 0,
        [left ? 'left' : 'right']: 0,
        width: 1.5, height: 44, background: cy,
        boxShadow: `0 0 6px ${cy}`,
      }} />
    </motion.div>
  );
}

function HUD({ pos, label, value, color = 'rgba(148,163,184,0.85)', delay }: {
  pos: 'tl' | 'tr' | 'bl' | 'br';
  label: string; value: string; color?: string; delay: number;
}) {
  const top  = pos.startsWith('t');
  const left = pos.endsWith('l');
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        [top ? 'top' : 'bottom']: 72,
        [left ? 'left' : 'right']: 24,
        textAlign: left ? 'left' : 'right',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.7, delay }}
    >
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 8, letterSpacing: '0.14em', color: 'rgba(100,116,139,0.7)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, letterSpacing: '0.1em', fontWeight: 500, color }}>
        {value}
      </div>
    </motion.div>
  );
}

function ScanLine() {
  return (
    <motion.div
      className="absolute inset-x-0 pointer-events-none"
      style={{ zIndex: 4 }}
      initial={{ top: '-4%' }}
      animate={{ top: '104%' }}
      transition={{ duration: 4.5, delay: 0.2, ease: 'linear', repeat: Infinity, repeatDelay: 1.2 }}
    >
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent 5%, rgba(6,182,212,0.7) 30%, rgba(99,102,241,1) 50%, rgba(6,182,212,0.7) 70%, transparent 95%)',
        boxShadow: '0 0 16px rgba(6,182,212,0.5), 0 0 40px rgba(99,102,241,0.25)',
      }} />
      <div style={{ height: 60, background: 'linear-gradient(to bottom, rgba(6,182,212,0.04), transparent)' }} />
    </motion.div>
  );
}

function Pulse({ size, delay }: { size: number; delay: number }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size, height: size,
        border: '1px solid rgba(99,102,241,0.5)',
        top: '50%', left: '50%',
        marginTop: -(size / 2), marginLeft: -(size / 2),
      }}
      initial={{ scale: 0.5, opacity: 0.7 }}
      animate={{ scale: 1.8, opacity: 0 }}
      transition={{ duration: 2.4, delay, ease: 'easeOut', repeat: Infinity, repeatDelay: 0.6 }}
    />
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

interface SplashScreenProps {
  onComplete: () => void;
}

const BRAND_CHARS = 'MEETSUMMARY'.split('');

const CAPS = [
  { icon: Zap,         label: 'LIVE TRANSCRIPTION', color: '#06b6d4' },
  { icon: Cpu,         label: 'AI INTELLIGENCE',    color: '#818cf8' },
  { icon: CheckSquare, label: 'ACTION ITEMS',        color: '#10b981' },
  { icon: FileText,    label: 'SMART SUMMARIES',     color: '#f59e0b' },
];

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [exiting, setExiting] = useState(false);

  useParticleCanvas(canvasRef);

  useEffect(() => {
    const t1 = setTimeout(() => setExiting(true),  EXIT_AT);
    const t2 = setTimeout(() => onComplete(),       UNMOUNT_AT);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden select-none"
          style={{ zIndex: 9999, background: '#030712' }}
        >
          {/* Particle canvas */}
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

          {/* Deep radial glow behind center */}
          <div className="absolute pointer-events-none" style={{
            width: 700, height: 700, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, rgba(6,182,212,0.05) 45%, transparent 70%)',
          }} />

          {/* Scan line */}
          <ScanLine />

          {/* Corner brackets */}
          <Bracket pos="tl" delay={0.3} />
          <Bracket pos="tr" delay={0.4} />
          <Bracket pos="bl" delay={0.5} />
          <Bracket pos="br" delay={0.6} />

          {/* HUD metadata */}
          <HUD pos="tl" label="SYSTEM" value="v2.4.1"   delay={0.9} />
          <HUD pos="tr" label="REGION" value="US-EAST-1" delay={1.0} />
          <HUD pos="bl" label="LATENCY" value="12 ms"   delay={1.1} />
          <HUD pos="br" label="STATUS" value="ONLINE" color="#10b981" delay={1.2} />

          {/* ── Center content ── */}
          <div className="relative z-10 flex flex-col items-center gap-7" style={{ maxWidth: 560 }}>

            {/* Logo mark */}
            <motion.div
              className="relative flex items-center justify-center"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Pulse rings (behind logo) */}
              <Pulse size={100} delay={1.3} />
              <Pulse size={148} delay={1.9} />
              <Pulse size={196} delay={2.5} />

              {/* Outer organic ring */}
              <motion.div
                className="absolute"
                style={{
                  width: 90, height: 90,
                  border: '1px solid rgba(99,102,241,0.45)',
                  borderRadius: '38% 62% 63% 37% / 41% 44% 56% 59%',
                  boxShadow: '0 0 24px rgba(99,102,241,0.35), inset 0 0 24px rgba(6,182,212,0.07)',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
              />
              {/* Inner organic ring */}
              <motion.div
                className="absolute"
                style={{
                  width: 72, height: 72,
                  border: '1px solid rgba(6,182,212,0.5)',
                  borderRadius: '62% 38% 37% 63% / 56% 59% 41% 44%',
                }}
                animate={{ rotate: -360 }}
                transition={{ duration: 6.5, repeat: Infinity, ease: 'linear' }}
              />

              {/* Core badge */}
              <div
                className="relative z-10 flex items-center justify-center rounded-2xl"
                style={{
                  width: 60, height: 60,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #0891b2 100%)',
                  boxShadow: '0 0 36px rgba(99,102,241,0.7), 0 0 70px rgba(6,182,212,0.25)',
                }}
              >
                <motion.span
                  style={{ fontFamily: 'Rajdhani,sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: 2, color: '#fff' }}
                  animate={{ textShadow: ['0 0 12px rgba(255,255,255,0.4)', '0 0 28px rgba(255,255,255,0.9)', '0 0 12px rgba(255,255,255,0.4)'] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
                >
                  MS
                </motion.span>
              </div>
            </motion.div>

            {/* Brand name — staggered letter reveal */}
            <div className="flex flex-col items-center gap-2.5">
              <motion.div
                className="flex"
                variants={{ visible: { transition: { staggerChildren: 0.04, delayChildren: 1.05 } } }}
                initial="hidden"
                animate="visible"
              >
                {BRAND_CHARS.map((ch, i) => (
                  <motion.span
                    key={i}
                    variants={{
                      hidden:   { opacity: 0, y: 36, filter: 'blur(10px)' },
                      visible:  { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
                    }}
                    className="inline-block"
                    style={{
                      fontFamily: 'Rajdhani,sans-serif',
                      fontSize: 'clamp(28px, 5vw, 56px)',
                      fontWeight: 700,
                      letterSpacing: '0.2em',
                      color: '#f8fafc',
                      textShadow: '0 0 32px rgba(99,102,241,0.55)',
                    }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </motion.div>

              {/* Subtitle strip */}
              <motion.div
                initial={{ opacity: 0, letterSpacing: '0.5em' }}
                animate={{ opacity: 1, letterSpacing: '0.28em' }}
                transition={{ duration: 1.4, delay: 1.7, ease: 'easeOut' }}
                style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 10, fontWeight: 500, color: '#06b6d4', letterSpacing: '0.28em' }}
              >
                VIRTUAL ASSISTANT · AI PRODUCTIVITY PLATFORM
              </motion.div>
            </div>

            {/* Gradient rule */}
            <motion.div
              style={{
                width: '100%', height: 1,
                background: 'linear-gradient(90deg, transparent, rgba(6,182,212,0.6), rgba(99,102,241,0.8), rgba(6,182,212,0.6), transparent)',
                transformOrigin: 'center',
              }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 1.1, delay: 1.85, ease: [0.22, 1, 0.36, 1] }}
            />

            {/* Tagline */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 2.05 }}
              style={{ fontFamily: 'Rajdhani,sans-serif', fontSize: 15, fontWeight: 500, letterSpacing: '0.1em', color: 'rgba(248,250,252,0.55)', textAlign: 'center' }}
            >
              Transcribe · Analyze · Summarize · Act
            </motion.p>

            {/* Capability chips */}
            <motion.div
              className="flex flex-wrap justify-center gap-2.5 px-4"
              variants={{ visible: { transition: { staggerChildren: 0.1, delayChildren: 2.25 } } }}
              initial="hidden"
              animate="visible"
            >
              {CAPS.map(({ icon: Icon, label, color }) => (
                <motion.div
                  key={label}
                  variants={{
                    hidden:  { opacity: 0, scale: 0.78, y: 12 },
                    visible: { opacity: 1, scale: 1,    y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
                  }}
                  className="flex items-center gap-1.5"
                  style={{
                    border:       `1px solid ${color}35`,
                    background:   `${color}0e`,
                    borderRadius: 6,
                    padding:      '5px 11px',
                  }}
                >
                  <Icon size={10} style={{ color, flexShrink: 0 }} strokeWidth={2.5} />
                  <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color }}>
                    {label}
                  </span>
                </motion.div>
              ))}
            </motion.div>

            {/* Progress bar */}
            <div className="w-full px-2 flex flex-col gap-1.5">
              <div style={{ height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
                <motion.div
                  style={{
                    height: '100%',
                    transformOrigin: 'left',
                    background: 'linear-gradient(90deg, #6366f1, #06b6d4 50%, #10b981)',
                    boxShadow: '0 0 10px rgba(6,182,212,0.7)',
                  }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 2.2, delay: 2.55, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <div className="flex items-center justify-between">
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 2.7 }}
                  style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 8.5, letterSpacing: '0.1em', color: 'rgba(100,116,139,0.7)' }}
                >
                  INITIALIZING WORKSPACE
                </motion.span>
                <ProgressCounter delay={2.6} />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─── Counting progress percentage ──────────────────────────────────────────*/
function ProgressCounter({ delay }: { delay: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = Date.now() + delay * 1000;
    const dur   = 2200;
    let raf: number;
    const tick = () => {
      const now     = Date.now();
      const elapsed = Math.max(0, now - start);
      const pct     = Math.min(100, Math.round((elapsed / dur) * 100));
      setVal(pct);
      if (pct < 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [delay]);

  return (
    <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 8.5, letterSpacing: '0.1em', color: 'rgba(100,116,139,0.7)' }}>
      {val}%
    </span>
  );
}

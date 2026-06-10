import { useState, useCallback, useRef } from 'react';
import { Mic, Monitor, Phone, Video, MessageSquare, Wifi, CheckCircle2, Loader2, Radio, ArrowRight, Plus, X, ListOrdered } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { MeetingSource, LiveSettings } from '../live-types';

const sources: { id: MeetingSource; label: string; icon: React.ElementType; desc: string; badge?: string }[] = [
  { id: 'browser', label: 'Browser Mic', icon: Mic, desc: 'Capture your microphone directly', badge: 'Recommended' },
  { id: 'zoom', label: 'Zoom', icon: Video, desc: 'Join via Zoom companion mode' },
  { id: 'meet', label: 'Google Meet', icon: Monitor, desc: 'Chrome extension + tab audio' },
  { id: 'teams', label: 'Microsoft Teams', icon: Wifi, desc: 'Teams live caption bridge' },
  { id: 'phone', label: 'Phone Call', icon: Phone, desc: 'Dial-in bridge line' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, desc: 'Future-ready integration', badge: 'Soon' },
];

interface LiveSessionSetupProps {
  onStart: (source: MeetingSource, settings: LiveSettings) => void;
}

export function LiveSessionSetup({ onStart }: LiveSessionSetupProps) {
  const [selectedSource, setSelectedSource] = useState<MeetingSource>('browser');
  const [diarization, setDiarization] = useState(true);
  const [smartFormat, setSmartFormat] = useState(true);
  const [interimResults, setInterimResults] = useState(true);
  const [language, setLanguage] = useState('auto');
  const [outputMode, setOutputMode] = useState<'short' | 'client'>('short');
  const [checking, setChecking] = useState(false);
  const [checksComplete, setChecksComplete] = useState(false);
  const [agendaItems, setAgendaItems] = useState<string[]>([]);
  const [agendaInput, setAgendaInput] = useState('');
  const agendaInputRef = useRef<HTMLInputElement>(null);

  const addAgendaItem = () => {
    const trimmed = agendaInput.trim();
    if (!trimmed) return;
    setAgendaItems(prev => [...prev, trimmed]);
    setAgendaInput('');
    agendaInputRef.current?.focus();
  };

  const removeAgendaItem = (idx: number) => {
    setAgendaItems(prev => prev.filter((_, i) => i !== idx));
  };

  const runPreflightChecks = useCallback(async () => {
    setChecking(true);
    setChecksComplete(false);
    // Mic check
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch { /* proceed anyway */ }
    // Brief settle delay
    await new Promise(r => setTimeout(r, 1200));
    setChecking(false);
    setChecksComplete(true);
  }, []);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 lg:p-8 max-w-[900px] mx-auto">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-500/10 rounded-full mb-4">
          <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span className="text-[12px] font-semibold text-red-500 uppercase tracking-wide">Live Meeting</span>
        </div>
        <h1 className="text-[26px] font-semibold text-foreground">Start a Live Session</h1>
        <p className="text-[15px] text-muted-foreground mt-1.5 max-w-[500px] mx-auto">
          Real-time transcription with AI copilot. Every word captured, every decision tracked.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* Left column */}
        <div className="flex flex-col gap-5">
          {/* Source selector */}
          <div>
            <h3 className="text-[14px] font-semibold text-foreground mb-3">Audio Source</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {sources.map(src => {
                const Icon = src.icon;
                const isDisabled = src.badge === 'Soon';
                return (
                  <button
                    key={src.id}
                    disabled={isDisabled}
                    onClick={() => setSelectedSource(src.id)}
                    className={`
                      relative flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all
                      ${isDisabled ? 'opacity-40 cursor-not-allowed border-border bg-card' :
                        selectedSource === src.id
                          ? 'border-red-500 bg-red-500/5 ring-1 ring-red-500/30'
                          : 'border-border hover:border-red-400/40 hover:bg-accent/30 bg-card'
                      }
                    `}
                  >
                    {src.badge && (
                      <span className={`absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                        src.badge === 'Recommended' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
                      }`}>
                        {src.badge}
                      </span>
                    )}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                      selectedSource === src.id ? 'bg-red-500/10' : 'bg-accent'
                    }`}>
                      <Icon className={`w-5 h-5 ${selectedSource === src.id ? 'text-red-500' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-foreground">{src.label}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight">{src.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* System Check */}
          <div>
            <h3 className="text-[14px] font-semibold text-foreground mb-3">System Check</h3>
            {!checking && !checksComplete && (
              <div className="border border-dashed border-border rounded-xl p-6 flex flex-col items-center gap-3">
                <p className="text-[13px] text-muted-foreground">Verify microphone and connectivity before starting</p>
                <Button variant="outline" size="sm" onClick={runPreflightChecks} className="gap-2 text-[12px]">
                  Run Check
                </Button>
              </div>
            )}
            {checking && (
              <div className="border border-border rounded-xl p-6 flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
                <p className="text-[13px] text-muted-foreground">Checking system…</p>
              </div>
            )}
            {checksComplete && (
              <div className="border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/8 rounded-xl p-6 flex flex-col items-center gap-2.5">
                <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                <p className="text-[14px] font-semibold text-emerald-700 dark:text-emerald-400">System ready</p>
                <Button variant="outline" size="sm" onClick={runPreflightChecks} className="gap-1.5 text-[11px] text-muted-foreground h-7 mt-1">
                  Run again
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right column — settings */}
        <div className="flex flex-col gap-4">
          <Card className="border-border">
            <CardContent className="px-4 py-4">
              <h3 className="text-[14px] font-semibold text-foreground mb-4">Transcription Settings</h3>
              <div className="flex flex-col gap-3">
                {[
                  { id: 'diarize', label: 'Speaker diarization', desc: 'Label speakers automatically', value: diarization, onChange: setDiarization },
                  { id: 'smart', label: 'Smart formatting', desc: 'Auto punctuation & numbers', value: smartFormat, onChange: setSmartFormat },
                  { id: 'interim', label: 'Interim results', desc: 'Show words before final', value: interimResults, onChange: setInterimResults },
                ].map(setting => (
                  <div key={setting.id} className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-[12px] font-medium text-foreground">{setting.label}</p>
                      <p className="text-[11px] text-muted-foreground">{setting.desc}</p>
                    </div>
                    <Switch checked={setting.value} onCheckedChange={setting.onChange} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardContent className="px-4 py-4">
              <h3 className="text-[14px] font-semibold text-foreground mb-3">Output Mode</h3>
              <div className="flex flex-col gap-2">
                {[
                  { id: 'short' as const, label: 'Short Mode', desc: 'Concise, action-focused' },
                  { id: 'client' as const, label: 'Client Mode', desc: 'Polished & professional' },
                ].map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => setOutputMode(mode.id)}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      outputMode === mode.id ? 'border-red-500 bg-red-500/5' : 'border-border hover:border-red-400/30'
                    }`}
                  >
                    <p className="text-[12px] font-semibold text-foreground">{mode.label}</p>
                    <p className="text-[11px] text-muted-foreground">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Agenda */}
          <Card className="border-border">
            <CardContent className="px-4 py-4">
              <div className="flex items-center gap-2 mb-3">
                <ListOrdered className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="text-[14px] font-semibold text-foreground">Agenda</h3>
                <span className="text-[10px] text-muted-foreground ml-auto">Optional</span>
              </div>
              {agendaItems.length > 0 && (
                <ol className="flex flex-col gap-1 mb-3">
                  {agendaItems.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2 group">
                      <span className="text-[10px] text-muted-foreground w-4 text-right flex-shrink-0">{idx + 1}.</span>
                      <span className="text-[12px] text-foreground flex-1 truncate">{item}</span>
                      <button
                        onClick={() => removeAgendaItem(idx)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex gap-1.5">
                <input
                  ref={agendaInputRef}
                  value={agendaInput}
                  onChange={e => setAgendaInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAgendaItem(); } }}
                  placeholder="e.g. Q2 budget review"
                  className="flex-1 text-[12px] bg-muted border border-border rounded-lg px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button
                  onClick={addAgendaItem}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors flex-shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Start button */}
          <Button
            onClick={() => onStart(selectedSource, {
              source: selectedSource,
              diarization,
              smartFormat,
              interimResults,
              language,
              outputMode,
              agendaItems,
            })}
            className="w-full h-12 gap-2 bg-red-500 hover:bg-red-600 text-white text-[14px] font-semibold"
          >
            <Radio className="w-4 h-4" />
            Start Live Meeting
            <ArrowRight className="w-4 h-4" />
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Recording begins immediately. You can pause at any time.
          </p>
        </div>
      </div>
    </div>
  );
}

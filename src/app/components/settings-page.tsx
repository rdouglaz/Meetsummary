import { useState, useCallback } from 'react';
import { Mic, Bell, Shield, Link2, FileSpreadsheet, BookOpen, SquareCheck, Check, Eye, EyeOff, Cpu, AlertTriangle, Trash2, RefreshCw, ChevronDown, ChevronUp, Globe, MessageSquare, Mail, Users, Plus, UserMinus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { getSetting, setSetting } from '../../lib/exports';
import { getAIErrorLog, clearAIErrorLog } from '../../lib/openrouter';
import { isComplianceModeEnabled, setComplianceMode } from '../../lib/pii';
import { getGlobalProfiles, setGlobalProfiles } from '../../lib/speaker-map';
import type { AIErrorEntry } from '../../lib/openrouter';

interface SettingsSectionProps {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
}

function SettingsSection({ icon: Icon, title, description, children, iconBg = 'bg-muted', iconColor = 'text-primary' }: SettingsSectionProps) {
  return (
    <Card className="border-border shadow-none bg-card">
      <CardHeader className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-[14.5px] font-semibold">{title}</CardTitle>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="px-5 py-4">{children}</CardContent>
    </Card>
  );
}

function SecretInput({ label, placeholder, storageKey, hint }: {
  label: string;
  placeholder: string;
  storageKey: Parameters<typeof getSetting>[0];
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState(() => getSetting(storageKey));
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSetting(storageKey, value.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Pendo Track: integration configured
    (window as any).pendo?.track('integration_configured', {
      integrationType: storageKey,
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[12.5px]">{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
            className="pr-9 h-9 bg-background"
          />
          <button
            onClick={() => setShow(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <Button onClick={handleSave} variant="outline" size="sm" className="gap-1.5 h-9 flex-shrink-0">
          {saved && <Check className="w-3.5 h-3.5 text-emerald-500" />}
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}

function PlainInput({ label, placeholder, storageKey, hint }: {
  label: string;
  placeholder: string;
  storageKey: Parameters<typeof getSetting>[0];
  hint?: string;
}) {
  const [value, setValue] = useState(() => getSetting(storageKey));
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSetting(storageKey, value.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Pendo Track: integration configured
    (window as any).pendo?.track('integration_configured', {
      integrationType: storageKey,
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[12.5px]">{label}</Label>
      <div className="flex gap-2">
        <Input type="text" value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} className="flex-1 h-9 bg-background" />
        <Button onClick={handleSave} variant="outline" size="sm" className="gap-1.5 h-9 flex-shrink-0">
          {saved && <Check className="w-3.5 h-3.5 text-emerald-500" />}
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, description, defaultChecked = false }: { label: string; description: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <div className="flex items-center justify-between py-2.5 gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={setChecked} className="flex-shrink-0" />
    </div>
  );
}

// Internal model registry — not shown in UI
export const llmModels = [
  { id: 'openai/gpt-oss-120b:free'                 },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free'    },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free'   },
  { id: 'minimax/minimax-m2.5:free'                },
  { id: 'google/gemma-4-26b-a4b-it:free'           },
  { id: 'mistralai/mistral-7b-instruct:free'       },
  { id: 'meta-llama/llama-3-8b-instruct:free'      },
  { id: 'openrouter/auto'                          }, // smart router — picks best available free model
];

function fmtTs(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function contextBadge(ctx: string) {
  const map: Record<string, string> = {
    'ask-ai':        'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    'upload-summary':'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    'live-summary':  'bg-red-500/10 text-red-600 dark:text-red-400',
  };
  return map[ctx] ?? 'bg-muted text-muted-foreground';
}

function AIErrorLogSection() {
  const [log, setLog]         = useState<AIErrorEntry[]>(() => getAIErrorLog());
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(() => setLog(getAIErrorLog()), []);
  const clear   = useCallback(() => { clearAIErrorLog(); setLog([]); }, []);

  const hasErrors = log.length > 0;

  return (
    <Card className="border-border shadow-none bg-card">
      <CardHeader className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${hasErrors ? 'bg-red-50 dark:bg-red-500/10' : 'bg-muted'}`}>
            <AlertTriangle className={`w-4 h-4 ${hasErrors ? 'text-red-500' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-[14.5px] font-semibold">AI Error Log</CardTitle>
              {hasErrors && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
                  {log.length}
                </span>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
              Failed OpenRouter calls — each entry shows which model was tried and why it failed
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={refresh}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {hasErrors && (
              <button
                onClick={clear}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                title="Clear log"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setExpanded(v => !v)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <>
          <Separator />
          <CardContent className="px-5 py-4">
            {log.length === 0 ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Check className="w-4 h-4 text-emerald-500" />
                <span className="text-[13px]">No errors recorded</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                {log.map((entry, i) => (
                  <div key={i} className="flex flex-col gap-1 p-3 rounded-xl bg-muted/50 border border-border">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">{fmtTs(entry.ts)}</span>
                      <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${contextBadge(entry.context)}`}>
                        {entry.context}
                      </span>
                      {entry.status && (
                        <span className="text-[9.5px] font-mono bg-red-500/10 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                          HTTP {entry.status}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground truncate" title={entry.model}>
                      Model: {entry.model}
                    </p>
                    <p className="text-[12px] text-foreground leading-relaxed break-words">{entry.error}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </>
      )}
    </Card>
  );
}

function ComplianceSection() {
  const [enabled, setEnabled] = useState(() => isComplianceModeEnabled());

  const toggle = (v: boolean) => {
    setEnabled(v);
    setComplianceMode(v);
    // Pendo Track: compliance mode toggled
    (window as any).pendo?.track('compliance_mode_toggled', { enabled: v });
  };

  return (
    <SettingsSection
      icon={Shield}
      title="Compliance Mode"
      description="Auto-redact PII from transcripts, enable audit logs, and enforce data residency controls"
      iconBg="bg-red-50 dark:bg-red-500/10"
      iconColor="text-red-600 dark:text-red-400"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between py-2 gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">Auto-redact PII</p>
            <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">
              Automatically replace email addresses, phone numbers, SSNs, credit card numbers, and IP addresses in transcripts with labeled placeholders.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={toggle} className="flex-shrink-0" />
        </div>
        {enabled && (
          <div className="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-[11.5px] text-amber-600 dark:text-amber-400 leading-relaxed">
              Compliance mode is active. PII patterns (email, phone, SSN, credit card, IP) will be redacted from displayed transcripts. Audit logs are enabled for all view, export, and share actions.
            </p>
          </div>
        )}
        <div className="flex flex-col divide-y divide-border/60">
          <div className="flex items-center justify-between py-2.5 gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">Audit Logging</p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">Record all view, export, share, and edit actions to the audit_logs table in Supabase.</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
              {enabled ? 'Active' : 'Off when compliance disabled'}
            </span>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

function SpeakerProfilesSection() {
  const [profiles, setProfiles] = useState<{ label: string; realName: string }[]>(() => getGlobalProfiles());
  const [newLabel, setNewLabel]     = useState('');
  const [newName, setNewName]       = useState('');
  const [saved, setSaved]           = useState(false);

  const add = () => {
    const label = newLabel.trim();
    const realName = newName.trim();
    if (!label || !realName) return;
    const updated = [...profiles.filter(p => p.label !== label), { label, realName }];
    setProfiles(updated);
    setGlobalProfiles(updated);
    setNewLabel('');
    setNewName('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    // Pendo Track: speaker profile saved
    (window as any).pendo?.track('speaker_profile_saved', {
      profileCount: updated.length,
    });
  };

  const remove = (label: string) => {
    const updated = profiles.filter(p => p.label !== label);
    setProfiles(updated);
    setGlobalProfiles(updated);
  };

  return (
    <SettingsSection
      icon={Users}
      title="Speaker Profiles"
      description="Map speaker labels (e.g. Speaker 0) to real names across all meetings"
      iconBg="bg-indigo-50 dark:bg-indigo-500/10"
      iconColor="text-indigo-600 dark:text-indigo-400"
    >
      <div className="flex flex-col gap-4">
        {profiles.length > 0 && (
          <div className="flex flex-col gap-2">
            {profiles.map(p => (
              <div key={p.label} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border">
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-mono text-muted-foreground">{p.label}</span>
                  <span className="mx-2 text-muted-foreground/50">→</span>
                  <span className="text-[13px] font-medium text-foreground">{p.realName}</span>
                </div>
                <button
                  onClick={() => remove(p.label)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label className="text-[12.5px]">Add / Update Profile</Label>
          <div className="flex gap-2">
            <Input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Speaker 0"
              className="flex-1 h-9 bg-background text-[13px]"
            />
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Alice Johnson"
              className="flex-1 h-9 bg-background text-[13px]"
              onKeyDown={e => e.key === 'Enter' && add()}
            />
            <Button onClick={add} variant="outline" size="sm" className="gap-1.5 h-9 flex-shrink-0">
              {saved ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Plus className="w-3.5 h-3.5" />}
              {saved ? 'Saved' : 'Add'}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Label matches the speaker ID from Deepgram (e.g. "Speaker 0", "0"). These mappings apply globally across all meetings.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

export function SettingsPage() {
  const [sttModel, setSttModel] = useState('nova-3');
  const [language, setLanguage] = useState('auto');
  const [translationLang, setTranslationLang] = useState(() => getSetting('TRANSLATION_LANGUAGE') || 'none');

  return (
    <div className="flex flex-col min-h-full">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="px-4 sm:px-6 py-4 max-w-[800px] mx-auto w-full">
          <h1 className="text-[17px] font-semibold text-foreground">Settings</h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 hidden sm:block">
            Manage integrations, transcription model, and preferences
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-[800px] mx-auto w-full flex flex-col gap-4">

        {/* AI Services */}
        <SettingsSection
          icon={Cpu}
          title="AI Services"
          description="Your API keys are stored locally in your browser and never sent to our servers"
          iconBg="bg-violet-50 dark:bg-violet-500/10"
          iconColor="text-violet-600 dark:text-violet-400"
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <p className="text-[13px] font-semibold text-foreground">Deepgram</p>
              <SecretInput
                label="API Key"
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                storageKey="DEEPGRAM_API_KEY"
                hint="Required for live meeting transcription. Get your key at deepgram.com/console."
              />
            </div>
            <Separator />
            <div className="flex flex-col gap-3">
              <p className="text-[13px] font-semibold text-foreground">OpenRouter</p>
              <SecretInput
                label="API Key"
                placeholder="sk-or-xxxxxxxxxxxxxxxxxxxx"
                storageKey="OPENROUTER_API_KEY"
                hint="Required for AI summaries and Ask AI chat. Get your key at openrouter.ai/keys."
              />
            </div>
          </div>
        </SettingsSection>

        {/* Export Integrations */}
        <SettingsSection
          icon={Link2}
          title="Export Integrations"
          description="Connect Notion, ClickUp, and Google Sheets to export action items"
          iconBg="bg-teal-50 dark:bg-teal-500/10"
          iconColor="text-teal-600 dark:text-teal-400"
        >
          <div className="flex flex-col gap-5">
            {/* Notion */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[13px] font-semibold text-foreground">Notion</p>
              </div>
              <SecretInput label="Integration Token" placeholder="secret_xxxxxxxxxxxxxxxxxxxx" storageKey="NOTION_TOKEN"
                hint="Create an internal integration at notion.so/my-integrations and copy the secret." />
              <PlainInput label="Database ID" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" storageKey="NOTION_DB_ID"
                hint="The 32-character ID from your Notion database URL." />
            </div>

            <Separator />

            {/* ClickUp */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <SquareCheck className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[13px] font-semibold text-foreground">ClickUp</p>
              </div>
              <SecretInput label="Personal API Token" placeholder="pk_xxxxxxxxxxxxxxxxxxxx" storageKey="CLICKUP_TOKEN"
                hint="Find your token at clickup.com → Profile → Apps → API Token." />
              <PlainInput label="List ID" placeholder="901234567890" storageKey="CLICKUP_LIST_ID"
                hint="The numeric ID of the ClickUp list where tasks will be created." />
            </div>

            <Separator />

            {/* Google Sheets */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[13px] font-semibold text-foreground">Google Sheets</p>
              </div>
              <PlainInput label="Apps Script Web App URL" placeholder="https://script.google.com/macros/s/…/exec" storageKey="GOOGLE_SHEETS_ID"
                hint="Deploy a Google Apps Script as a Web App that accepts POST requests." />
            </div>

            <Separator />

            {/* HubSpot */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[13px] font-semibold text-foreground">HubSpot CRM</p>
              </div>
              <SecretInput label="Private App Token" placeholder="pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" storageKey="HUBSPOT_API_KEY"
                hint="Create a Private App in HubSpot → Settings → Integrations → Private Apps. Requires crm.objects.notes.write scope." />
            </div>

            <Separator />

            {/* Salesforce */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[13px] font-semibold text-foreground">Salesforce CRM</p>
              </div>
              <PlainInput label="Instance URL" placeholder="https://yourorg.my.salesforce.com" storageKey="SALESFORCE_INSTANCE_URL"
                hint="Your Salesforce org domain, e.g. https://mycompany.my.salesforce.com" />
              <SecretInput label="Consumer Key (Client ID)" placeholder="3MVG9..." storageKey="SALESFORCE_CLIENT_ID"
                hint="From a Connected App in Salesforce → Setup → App Manager." />
              <SecretInput label="Consumer Secret (Client Secret)" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" storageKey="SALESFORCE_CLIENT_SECRET" />
              <PlainInput label="Username" placeholder="you@yourorg.com" storageKey="SALESFORCE_USERNAME" />
              <SecretInput label="Password" placeholder="yourPassword" storageKey="SALESFORCE_PASSWORD"
                hint="Account password." />
              <SecretInput label="Security Token" placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" storageKey="SALESFORCE_TOKEN"
                hint="Appended to password for API auth. Reset at Salesforce → Settings → Reset Security Token." />
            </div>
          </div>
        </SettingsSection>

        {/* Transcription */}
        <SettingsSection
          icon={Mic}
          title="Transcription"
          description="Deepgram Nova-3 model and feature configuration"
          iconBg="bg-indigo-50 dark:bg-indigo-500/10"
          iconColor="text-indigo-600 dark:text-indigo-400"
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[12.5px]">STT Model</Label>
                <Select value={sttModel} onValueChange={setSttModel}>
                  <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nova-3">Nova-3 (Primary)</SelectItem>
                    <SelectItem value="nova-2">Nova-2 (Fallback)</SelectItem>
                    <SelectItem value="enhanced">Enhanced</SelectItem>
                    <SelectItem value="base">Base</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[12.5px]">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="pt">Portuguese</SelectItem>
                    <SelectItem value="zh">Mandarin</SelectItem>
                    <SelectItem value="ja">Japanese</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Live Translation */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12.5px]">Live Translation</Label>
              <Select value={translationLang} onValueChange={v => { setTranslationLang(v); setSetting('TRANSLATION_LANGUAGE', v); }}>
                <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Disabled</SelectItem>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="Spanish">Spanish</SelectItem>
                  <SelectItem value="French">French</SelectItem>
                  <SelectItem value="German">German</SelectItem>
                  <SelectItem value="Portuguese">Portuguese</SelectItem>
                  <SelectItem value="Mandarin Chinese">Mandarin Chinese</SelectItem>
                  <SelectItem value="Japanese">Japanese</SelectItem>
                  <SelectItem value="Korean">Korean</SelectItem>
                  <SelectItem value="Arabic">Arabic</SelectItem>
                  <SelectItem value="Hindi">Hindi</SelectItem>
                  <SelectItem value="Russian">Russian</SelectItem>
                  <SelectItem value="Italian">Italian</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Translate each utterance in real-time using OpenRouter AI. Requires OpenRouter API key.</p>
            </div>
            <Separator />
            <div className="flex flex-col divide-y divide-border/60">
              <ToggleRow label="Speaker Diarization" description="Automatically identify and label different speakers" defaultChecked />
              <ToggleRow label="Smart Formatting" description="Format numbers, dates, and punctuation intelligently" defaultChecked />
              <ToggleRow label="Utterances" description="Break transcript into speaker utterances" defaultChecked />
              <ToggleRow label="Word Timestamps" description="Enable word-level highlighting synced to audio" defaultChecked />
              <ToggleRow label="Paragraphs" description="Auto-organize transcript into paragraphs" defaultChecked />
            </div>
          </div>
        </SettingsSection>

        {/* Notifications — Slack / Teams / Email */}
        <SettingsSection
          icon={MessageSquare}
          title="Notifications & Alerts"
          description="Post meeting summaries to Slack, Microsoft Teams, or send via email"
          iconBg="bg-cyan-50 dark:bg-cyan-500/10"
          iconColor="text-cyan-600 dark:text-cyan-400"
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[13px] font-semibold text-foreground">Slack</p>
              </div>
              <PlainInput label="Incoming Webhook URL" placeholder="https://hooks.slack.com/services/T.../B.../xxx" storageKey="SLACK_WEBHOOK_URL"
                hint="Create an Incoming Webhook in your Slack app settings. Must start with https://hooks.slack.com/" />
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[13px] font-semibold text-foreground">Microsoft Teams</p>
              </div>
              <PlainInput label="Incoming Webhook URL" placeholder="https://yourorg.webhook.office.com/webhookb2/..." storageKey="TEAMS_WEBHOOK_URL"
                hint="Create an Incoming Webhook connector in your Teams channel settings." />
            </div>


            <Separator />

            <div className="flex flex-col divide-y divide-border/60">
              <ToggleRow label="Processing Complete" description="Notify when transcription and summary are ready" defaultChecked />
              <ToggleRow label="Action Item Reminders" description="Daily digest of pending tasks" defaultChecked />
              <ToggleRow label="Weekly Summary" description="Weekly report of meeting activity" />
            </div>
          </div>
        </SettingsSection>

        {/* Compliance Mode */}
        <ComplianceSection />

        {/* Speaker Profiles */}
        <SpeakerProfilesSection />

        {/* Data & Privacy */}
        <SettingsSection
          icon={Shield}
          title="Data & Privacy"
          description="Control how your meeting data is stored and handled"
          iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          iconColor="text-emerald-600 dark:text-emerald-400"
        >
          <div className="flex flex-col divide-y divide-border/60">
            <ToggleRow label="Auto-delete Recordings" description="Delete source audio from storage after transcription completes" />
            <ToggleRow label="End-to-End Encryption" description="Encrypt transcripts at rest in Supabase" defaultChecked />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="text-destructive border-destructive/25 hover:bg-destructive/5 hover:border-destructive/40">
              Delete All Data
            </Button>
            <Button variant="outline" size="sm">Export My Data</Button>
          </div>
        </SettingsSection>

        {/* AI Error Log */}
        <AIErrorLogSection />

      </div>
    </div>
  );
}

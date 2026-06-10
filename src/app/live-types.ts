export type LivePhase = 'setup' | 'connecting' | 'live' | 'paused' | 'ending' | 'done';
export type MeetingSource = 'browser' | 'zoom' | 'meet' | 'teams' | 'phone' | 'whatsapp';
export type AIEventType = 'action_item' | 'decision' | 'risk' | 'question' | 'commitment' | 'important';

export interface LiveWord {
  word: string;
  isFinal: boolean;
  confidence: number;
}

export interface LiveUtterance {
  id: string;
  speaker: string;
  text: string;
  startTime: number;
  endTime?: number;
  isFinal: boolean;
  words?: LiveWord[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  translation?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export interface CoachingPrompt {
  id: string;
  type: 'tip' | 'caution' | 'question';
  content: string;
  timestamp: number;
}

export interface AIEvent {
  id: string;
  type: AIEventType;
  content: string;
  owner?: string;
  dueDate?: string;
  confidence: number;
  timestamp: number;
  approved?: boolean;
  edited?: boolean;
}

export interface LiveSummaryState {
  running: string;
  decisions: string[];
  actionItems: AIEvent[];
  risks: AIEvent[];
  questions: AIEvent[];
  commitments: AIEvent[];
  importantMoments: AIEvent[];
  lastUpdated: number;
}

export interface LiveSettings {
  source: MeetingSource;
  diarization: boolean;
  smartFormat: boolean;
  interimResults: boolean;
  language: string;
  outputMode: 'short' | 'client';
  agendaItems: string[];
}

export interface LiveSession {
  id: string;
  source: MeetingSource;
  startedAt: number;
  title: string;
  participants: string[];
  utterances: LiveUtterance[];
  summary: LiveSummaryState;
  phase: LivePhase;
}

export interface StreamChunk {
  utterance_id: string;
  speaker: string;
  text: string;
  words: { word: string; start: number; end: number; confidence: number }[];
  is_final: boolean;
  start: number;
  duration: number;
}

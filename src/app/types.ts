export type MeetingStatus = 'uploading' | 'transcribing' | 'summarizing' | 'complete' | 'error';
export type OutputMode = 'short' | 'client';
export type ActionItemStatus = 'pending' | 'in_progress' | 'complete';

export interface Speaker {
  id: string;
  label: string;
  color: string;
}

export interface TranscriptWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker: string;
  confidence: number;
}

export interface TranscriptUtterance {
  speaker: string;
  start: number;
  end: number;
  transcript: string;
  words: TranscriptWord[];
}

export interface ActionItem {
  id: string;
  meetingId: string;
  owner: string;
  task: string;
  dueDate: string;
  status: ActionItemStatus;
}

export interface MeetingSummary {
  overview: {
    date: string;
    duration: string;
    participants: string[];
    mainPurpose: string;
  };
  keyDiscussionPoints: string[];
  keyDecisions: string[];
  actionItems: ActionItem[];
  followUpEmail: string;
  risks: string[];
}

export interface Meeting {
  id: string;
  userId: string;
  title: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  duration: number;
  status: MeetingStatus;
  progress: number;
  transcript: TranscriptUtterance[];
  summary: MeetingSummary | null;
  createdAt: string;
  tags: string[];
  source: 'zoom' | 'meet' | 'whatsapp' | 'phone' | 'upload';
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  plan: 'free' | 'pro' | 'business';
}

export type NavPage = 'dashboard' | 'upload' | 'meetings' | 'meeting-detail' | 'action-items' | 'settings' | 'live' | 'analytics' | 'team';

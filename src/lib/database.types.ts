export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      meetings: {
        Row: {
          id: string;
          user_id: string | null;
          title: string;
          file_url: string | null;
          file_name: string | null;
          file_size: number | null;
          duration: number | null;
          status: 'uploading' | 'transcribing' | 'summarizing' | 'complete' | 'error';
          progress: number;
          source: 'zoom' | 'meet' | 'teams' | 'whatsapp' | 'phone' | 'upload' | 'browser';
          tags: string[] | null;
          agenda_items: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['meetings']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string; agenda_items?: string[] };
        Update: Partial<Database['public']['Tables']['meetings']['Row']>;
      };
      live_sessions: {
        Row: {
          id: string;
          meeting_id: string | null;
          user_id: string | null;
          started_at: string;
          ended_at: string | null;
          status: 'active' | 'paused' | 'ended';
          source: string;
          settings: Json | null;
        };
        Insert: Omit<Database['public']['Tables']['live_sessions']['Row'], 'id' | 'started_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['live_sessions']['Row']>;
      };
      transcript_chunks: {
        Row: {
          id: string;
          session_id: string | null;
          meeting_id: string | null;
          speaker: string | null;
          text: string;
          timestamp_start: number | null;
          timestamp_end: number | null;
          is_final: boolean;
          words: Json | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['transcript_chunks']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['transcript_chunks']['Row']>;
      };
      ai_events: {
        Row: {
          id: string;
          meeting_id: string | null;
          session_id: string | null;
          type: 'action_item' | 'decision' | 'risk' | 'question' | 'commitment' | 'important';
          content: string;
          owner: string | null;
          due_date: string | null;
          confidence: number | null;
          approved: boolean | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['ai_events']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['ai_events']['Row']>;
      };
      action_items: {
        Row: {
          id: string;
          meeting_id: string | null;
          owner: string | null;
          task: string;
          due_date: string | null;
          status: 'pending' | 'in_progress' | 'complete';
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['action_items']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['action_items']['Row']>;
      };
      summaries: {
        Row: {
          id: string;
          meeting_id: string;
          overview: Json;
          key_discussion_points: string[] | null;
          key_decisions: string[] | null;
          follow_up_email: string | null;
          risks: string[] | null;
          mode: 'short' | 'client';
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['summaries']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['summaries']['Row']>;
      };
    };
  };
}

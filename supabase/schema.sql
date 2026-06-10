-- ============================================================
-- MeetSummary — Production Schema & RLS Policies
-- ============================================================
-- Safe to re-run multiple times in the Supabase SQL editor.
-- Uses IF NOT EXISTS / IF EXISTS / DO blocks so every
-- statement is idempotent — no errors on subsequent runs.
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tables ───────────────────────────────────────────────────────────────────

-- meetings
CREATE TABLE IF NOT EXISTS meetings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  title       TEXT        NOT NULL DEFAULT 'Untitled Meeting',
  file_url    TEXT,
  file_name   TEXT,
  file_size   BIGINT,
  duration    INTEGER,
  status      TEXT        NOT NULL DEFAULT 'uploading'
                CHECK (status IN ('uploading','transcribing','summarizing','complete','error')),
  progress    INTEGER     NOT NULL DEFAULT 0
                CHECK (progress >= 0 AND progress <= 100),
  source      TEXT        NOT NULL DEFAULT 'upload'
                CHECK (source IN ('zoom','meet','teams','whatsapp','phone','upload','browser')),
  tags          TEXT[],
  agenda_items  TEXT[]      NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration for existing deployments
DO $$ BEGIN
  ALTER TABLE meetings ADD COLUMN IF NOT EXISTS agenda_items TEXT[] NOT NULL DEFAULT '{}';
END $$;

-- live_sessions
CREATE TABLE IF NOT EXISTS live_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID        REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused','ended')),
  source      TEXT        NOT NULL DEFAULT 'browser',
  settings    JSONB
);

-- transcript_chunks
CREATE TABLE IF NOT EXISTS transcript_chunks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        REFERENCES live_sessions(id) ON DELETE CASCADE,
  meeting_id       UUID        REFERENCES meetings(id) ON DELETE CASCADE,
  speaker          TEXT,
  text             TEXT        NOT NULL,
  timestamp_start  FLOAT,
  timestamp_end    FLOAT,
  is_final         BOOLEAN     NOT NULL DEFAULT false,
  words            JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ai_events
CREATE TABLE IF NOT EXISTS ai_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID        REFERENCES meetings(id) ON DELETE CASCADE,
  session_id  UUID        REFERENCES live_sessions(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL
                CHECK (type IN ('action_item','decision','risk','question','commitment','important')),
  content     TEXT        NOT NULL,
  owner       TEXT,
  due_date    TEXT,
  confidence  FLOAT       DEFAULT 0.9,
  approved    BOOLEAN,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- action_items
CREATE TABLE IF NOT EXISTS action_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID        REFERENCES meetings(id) ON DELETE CASCADE,
  owner       TEXT,
  task        TEXT        NOT NULL,
  due_date    TEXT,
  status      TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','complete')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- summaries
CREATE TABLE IF NOT EXISTS summaries (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id            UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  overview              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  key_discussion_points TEXT[],
  key_decisions         TEXT[],
  follow_up_email       TEXT,
  risks                 TEXT[],
  mode                  TEXT        NOT NULL DEFAULT 'short'
                CHECK (mode IN ('short','client')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meetings_user_id        ON meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status         ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_created_at     ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_sessions_meeting   ON live_sessions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_user      ON live_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_transcript_session      ON transcript_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_transcript_meeting      ON transcript_chunks(meeting_id);
-- Partial index for fast final-chunk lookups (karaoke player, transcript view)
CREATE INDEX IF NOT EXISTS idx_transcript_final        ON transcript_chunks(meeting_id, timestamp_start)
  WHERE is_final = true;
CREATE INDEX IF NOT EXISTS idx_ai_events_session       ON ai_events(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_events_meeting       ON ai_events(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_meeting    ON action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status     ON action_items(status);
CREATE INDEX IF NOT EXISTS idx_summaries_meeting       ON summaries(meeting_id);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Recreate triggers idempotently
DROP TRIGGER IF EXISTS meetings_set_updated_at  ON meetings;
CREATE TRIGGER meetings_set_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS summaries_set_updated_at ON summaries;
CREATE TRIGGER summaries_set_updated_at
  BEFORE UPDATE ON summaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security — enable ─────────────────────────────────────────────
ALTER TABLE meetings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries         ENABLE ROW LEVEL SECURITY;

-- Enforce RLS for the table owner role as well (production safety)
ALTER TABLE meetings          FORCE ROW LEVEL SECURITY;
ALTER TABLE live_sessions     FORCE ROW LEVEL SECURITY;
ALTER TABLE transcript_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_events         FORCE ROW LEVEL SECURITY;
ALTER TABLE action_items      FORCE ROW LEVEL SECURITY;
ALTER TABLE summaries         FORCE ROW LEVEL SECURITY;

-- ─── Remove development / legacy permissive policies ─────────────────────────
-- These granted unrestricted access to unauthenticated (anon) callers.
DROP POLICY IF EXISTS "anon_all_meetings"          ON meetings;
DROP POLICY IF EXISTS "anon_all_live_sessions"     ON live_sessions;
DROP POLICY IF EXISTS "anon_all_transcript_chunks" ON transcript_chunks;
DROP POLICY IF EXISTS "anon_all_ai_events"         ON ai_events;
DROP POLICY IF EXISTS "anon_all_action_items"      ON action_items;
DROP POLICY IF EXISTS "anon_all_summaries"         ON summaries;
-- Drop any other generic legacy names that may have been used
DROP POLICY IF EXISTS "enable_all_for_users"  ON meetings;
DROP POLICY IF EXISTS "enable_all_for_users"  ON live_sessions;
DROP POLICY IF EXISTS "enable_all_for_users"  ON transcript_chunks;
DROP POLICY IF EXISTS "enable_all_for_users"  ON ai_events;
DROP POLICY IF EXISTS "enable_all_for_users"  ON action_items;
DROP POLICY IF EXISTS "enable_all_for_users"  ON summaries;

-- ─── meetings — user-scoped RLS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "meetings_select_own" ON meetings;
DROP POLICY IF EXISTS "meetings_insert_own" ON meetings;
DROP POLICY IF EXISTS "meetings_update_own" ON meetings;
DROP POLICY IF EXISTS "meetings_delete_own" ON meetings;

CREATE POLICY "meetings_select_own"
  ON meetings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "meetings_insert_own"
  ON meetings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meetings_update_own"
  ON meetings FOR UPDATE
  TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meetings_delete_own"
  ON meetings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ─── live_sessions — user-scoped RLS ─────────────────────────────────────────
DROP POLICY IF EXISTS "live_sessions_select_own" ON live_sessions;
DROP POLICY IF EXISTS "live_sessions_insert_own" ON live_sessions;
DROP POLICY IF EXISTS "live_sessions_update_own" ON live_sessions;
DROP POLICY IF EXISTS "live_sessions_delete_own" ON live_sessions;

CREATE POLICY "live_sessions_select_own"
  ON live_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "live_sessions_insert_own"
  ON live_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "live_sessions_update_own"
  ON live_sessions FOR UPDATE
  TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "live_sessions_delete_own"
  ON live_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ─── transcript_chunks — access via meeting ownership ─────────────────────────
-- A chunk is readable/writable if the parent meeting belongs to the caller.
-- Chunks from live sessions always carry both meeting_id and session_id.
DROP POLICY IF EXISTS "transcript_chunks_select_own" ON transcript_chunks;
DROP POLICY IF EXISTS "transcript_chunks_insert_own" ON transcript_chunks;
DROP POLICY IF EXISTS "transcript_chunks_update_own" ON transcript_chunks;
DROP POLICY IF EXISTS "transcript_chunks_delete_own" ON transcript_chunks;

CREATE POLICY "transcript_chunks_select_own"
  ON transcript_chunks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_chunks.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "transcript_chunks_insert_own"
  ON transcript_chunks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_chunks.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "transcript_chunks_update_own"
  ON transcript_chunks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_chunks.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "transcript_chunks_delete_own"
  ON transcript_chunks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_chunks.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- ─── ai_events — access via meeting ownership ─────────────────────────────────
DROP POLICY IF EXISTS "ai_events_select_own" ON ai_events;
DROP POLICY IF EXISTS "ai_events_insert_own" ON ai_events;
DROP POLICY IF EXISTS "ai_events_update_own" ON ai_events;
DROP POLICY IF EXISTS "ai_events_delete_own" ON ai_events;

CREATE POLICY "ai_events_select_own"
  ON ai_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = ai_events.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_events_insert_own"
  ON ai_events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = ai_events.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_events_update_own"
  ON ai_events FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = ai_events.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_events_delete_own"
  ON ai_events FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = ai_events.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- ─── action_items — access via meeting ownership ──────────────────────────────
DROP POLICY IF EXISTS "action_items_select_own" ON action_items;
DROP POLICY IF EXISTS "action_items_insert_own" ON action_items;
DROP POLICY IF EXISTS "action_items_update_own" ON action_items;
DROP POLICY IF EXISTS "action_items_delete_own" ON action_items;

CREATE POLICY "action_items_select_own"
  ON action_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = action_items.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "action_items_insert_own"
  ON action_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = action_items.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "action_items_update_own"
  ON action_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = action_items.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "action_items_delete_own"
  ON action_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = action_items.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- ─── summaries — access via meeting ownership ─────────────────────────────────
DROP POLICY IF EXISTS "summaries_select_own" ON summaries;
DROP POLICY IF EXISTS "summaries_insert_own" ON summaries;
DROP POLICY IF EXISTS "summaries_update_own" ON summaries;
DROP POLICY IF EXISTS "summaries_delete_own" ON summaries;

CREATE POLICY "summaries_select_own"
  ON summaries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = summaries.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "summaries_insert_own"
  ON summaries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = summaries.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "summaries_update_own"
  ON summaries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = summaries.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

CREATE POLICY "summaries_delete_own"
  ON summaries FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = summaries.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- ─── Audit logs (Compliance mode) ────────────────────────────────────────────
-- Required when compliance mode is enabled in Settings → Privacy.
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action        TEXT        NOT NULL,
  resource_type TEXT        NOT NULL,
  resource_id   UUID,
  metadata      JSONB       DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user       ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_own" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_own" ON audit_logs;

CREATE POLICY "audit_logs_select_own"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "audit_logs_insert_own"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ─── Organizations (Team Workspace) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        UNIQUE,
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        TEXT        NOT NULL DEFAULT 'team',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'member',
  status      TEXT        NOT NULL DEFAULT 'pending',
  invited_by  UUID        REFERENCES auth.users(id),
  joined_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- Add org_id foreign key to meetings for team sharing
DO $$ BEGIN
  ALTER TABLE meetings ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id  ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_org_id     ON meetings(org_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE org_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members   FORCE ROW LEVEL SECURITY;

-- ── SECURITY DEFINER helpers (bypass RLS to avoid circular references) ────────
-- Without these, org_members policies query organizations which has a policy
-- that queries org_members → infinite recursion.

CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM org_members WHERE user_id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id AND owner_id = auth.uid());
$$;

DROP POLICY IF EXISTS "orgs_owner_all"     ON organizations;
DROP POLICY IF EXISTS "orgs_member_read"   ON organizations;
DROP POLICY IF EXISTS "org_members_owner"  ON org_members;
DROP POLICY IF EXISTS "org_members_self"   ON org_members;
DROP POLICY IF EXISTS "org_members_insert" ON org_members;
DROP POLICY IF EXISTS "meetings_org_read"  ON meetings;

-- Org owners: full CRUD on their own org
CREATE POLICY "orgs_owner_all" ON organizations FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Org members: read-only access to their org (uses SECURITY DEFINER — no recursion)
CREATE POLICY "orgs_member_read" ON organizations FOR SELECT TO authenticated
  USING (id IN (SELECT public.get_user_org_ids()));

-- Org owners: full control over org_members rows (uses SECURITY DEFINER — no recursion)
CREATE POLICY "org_members_owner" ON org_members FOR ALL TO authenticated
  USING (public.is_org_owner(org_id))
  WITH CHECK (public.is_org_owner(org_id));

-- Members: read their own membership record
CREATE POLICY "org_members_self" ON org_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Shared meetings: org members can read meetings shared with their org
CREATE POLICY "meetings_org_read" ON meetings FOR SELECT TO authenticated
  USING (
    org_id IS NOT NULL
    AND org_id IN (SELECT public.get_user_org_ids())
  );

-- ─── Realtime publication — idempotent ───────────────────────────────────────
-- ALTER PUBLICATION errors if a table is already a member,
-- so we check pg_publication_tables first.
DO $$
DECLARE
  tbl TEXT;
  tbl_list TEXT[] := ARRAY[
    'meetings','live_sessions','transcript_chunks','ai_events','action_items','summaries'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbl_list LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    END IF;
  END LOOP;
END;
$$;

-- ─── Data migration: assign orphaned rows to current session ─────────────────
-- If you ran the app before auth was enabled, some meetings have user_id = NULL.
-- You can claim them for your account by running the UPDATE below once,
-- replacing <YOUR_USER_UUID> with your auth.users id from the Supabase Auth tab.
--
-- UPDATE meetings SET user_id = '<YOUR_USER_UUID>' WHERE user_id IS NULL;

-- Scheduled Batch Ingestion System (SPEC 2)
-- Enables enterprise scheduling for automatic ingestion from storage sources

-- ============================================================================
-- 1. INGEST SOURCES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Source type
  type text NOT NULL CHECK (type IN (
    'S3',
    'GCS',
    'AZURE_BLOB',
    'SFTP',
    'MANIFEST_URL',
    'GDRIVE',
    'DROPBOX'
  )),
  
  -- Source configuration (bucket, prefix, credentials ref, etc.)
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Source name/description
  name text,
  description text,
  
  -- Status
  enabled bool NOT NULL DEFAULT true,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ingest_sources_org_id ON public.ingest_sources(org_id);
CREATE INDEX IF NOT EXISTS idx_ingest_sources_type ON public.ingest_sources(type);
CREATE INDEX IF NOT EXISTS idx_ingest_sources_enabled ON public.ingest_sources(enabled) WHERE enabled = true;

CREATE TRIGGER trg_ingest_sources_updated_at
BEFORE UPDATE ON public.ingest_sources
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. INGEST SCHEDULES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.ingest_sources(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Schedule name
  name text NOT NULL,
  description text,
  
  -- Schedule status
  enabled bool NOT NULL DEFAULT true,
  
  -- Recurrence rule (RRULE text or cron expression)
  rrule text NOT NULL,
  
  -- Template and mode configuration
  template_id uuid REFERENCES public.templates(id) ON DELETE SET NULL,
  mode text CHECK (mode IN ('TRANSCRIPT_ONLY', 'AUDIO_ONLY', 'AUDIO_PLUS_TRANSCRIPT')) DEFAULT 'AUDIO_PLUS_TRANSCRIPT',
  
  -- Deduplication strategy
  dedupe_strategy text NOT NULL DEFAULT 'object_key_etag' CHECK (dedupe_strategy IN (
    'object_key_etag',
    'object_key_hash',
    'none'
  )),
  
  -- Schedule execution tracking
  last_run_at timestamptz,
  next_run_at timestamptz,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_schedules_org_id ON public.ingest_schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_ingest_schedules_source_id ON public.ingest_schedules(source_id);
CREATE INDEX IF NOT EXISTS idx_ingest_schedules_enabled ON public.ingest_schedules(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_ingest_schedules_next_run_at ON public.ingest_schedules(next_run_at) WHERE enabled = true;

CREATE TRIGGER trg_ingest_schedules_updated_at
BEFORE UPDATE ON public.ingest_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. INGEST SCHEDULE RUNS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.ingest_schedules(id) ON DELETE CASCADE,
  
  -- Run status
  status text NOT NULL CHECK (status IN (
    'RUNNING',
    'COMPLETE',
    'FAILED',
    'CANCELED'
  )) DEFAULT 'RUNNING',
  
  -- Execution timestamps
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  
  -- Statistics
  stats_json jsonb DEFAULT '{
    "new_files": 0,
    "parsed": 0,
    "failed": 0,
    "skipped": 0
  }'::jsonb,
  
  -- Resulting import (links to ingest_imports)
  import_id uuid REFERENCES public.ingest_imports(id) ON DELETE SET NULL,
  
  -- Log/output
  log_text text,
  log_json jsonb
);

CREATE INDEX IF NOT EXISTS idx_ingest_schedule_runs_schedule_id ON public.ingest_schedule_runs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_ingest_schedule_runs_status ON public.ingest_schedule_runs(status);
CREATE INDEX IF NOT EXISTS idx_ingest_schedule_runs_started_at ON public.ingest_schedule_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_schedule_runs_import_id ON public.ingest_schedule_runs(import_id);

-- ============================================================================
-- 4. INGEST OBJECTS TABLE (Deduplication Tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.ingest_sources(id) ON DELETE CASCADE,
  
  -- Object identification
  object_key text NOT NULL,
  etag text,
  hash text, -- SHA-256 hash of object content
  
  -- Tracking
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_processed_at timestamptz,
  
  -- Status
  status text NOT NULL CHECK (status IN (
    'PENDING',
    'PROCESSING',
    'PROCESSED',
    'FAILED',
    'SKIPPED'
  )) DEFAULT 'PENDING',
  
  -- Resulting conversation (if processed)
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  
  -- Unique constraint: one record per object_key per source
  UNIQUE(source_id, object_key)
);

CREATE INDEX IF NOT EXISTS idx_ingest_objects_source_id ON public.ingest_objects(source_id);
CREATE INDEX IF NOT EXISTS idx_ingest_objects_object_key ON public.ingest_objects(object_key);
CREATE INDEX IF NOT EXISTS idx_ingest_objects_status ON public.ingest_objects(status);
CREATE INDEX IF NOT EXISTS idx_ingest_objects_last_processed_at ON public.ingest_objects(last_processed_at);
CREATE INDEX IF NOT EXISTS idx_ingest_objects_hash ON public.ingest_objects(hash) WHERE hash IS NOT NULL;

-- ============================================================================
-- 5. RLS POLICIES
-- ============================================================================

ALTER TABLE public.ingest_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_schedule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_objects ENABLE ROW LEVEL SECURITY;

-- Ingest sources: org members can view, ANALYST+ can create/update
CREATE POLICY "ingest_sources_select_if_member"
ON public.ingest_sources FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "ingest_sources_insert_if_analyst"
ON public.ingest_sources FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "ingest_sources_update_if_analyst"
ON public.ingest_sources FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Ingest schedules: org members can view, ANALYST+ can create/update
CREATE POLICY "ingest_schedules_select_if_member"
ON public.ingest_schedules FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "ingest_schedules_insert_if_analyst"
ON public.ingest_schedules FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "ingest_schedules_update_if_analyst"
ON public.ingest_schedules FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Ingest schedule runs: org members can view (via schedule)
CREATE POLICY "ingest_schedule_runs_select_if_member"
ON public.ingest_schedule_runs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.ingest_schedules
    WHERE id = ingest_schedule_runs.schedule_id
      AND public.is_org_member(org_id)
  )
);

-- Ingest objects: org members can view (via source)
CREATE POLICY "ingest_objects_select_if_member"
ON public.ingest_objects FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.ingest_sources
    WHERE id = ingest_objects.source_id
      AND public.is_org_member(org_id)
  )
);

-- Comments
COMMENT ON TABLE public.ingest_sources IS 'Storage sources (S3, GCS, SFTP, etc.) for scheduled ingestion';
COMMENT ON TABLE public.ingest_schedules IS 'Scheduled ingestion jobs with recurrence rules';
COMMENT ON TABLE public.ingest_schedule_runs IS 'Execution history for scheduled ingestion jobs';
COMMENT ON TABLE public.ingest_objects IS 'Tracks processed objects for deduplication';


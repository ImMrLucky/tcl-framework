-- Batch Ingestion System (Phase 6)
-- Enables enterprise batch ingestion from storage connectors (S3, Dropbox, etc.)

-- ============================================================================
-- 1. INGESTION BATCHES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  env text NOT NULL CHECK (env IN ('sandbox', 'production')) DEFAULT 'sandbox',
  
  -- Batch creator
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Source information
  source_type text NOT NULL CHECK (source_type IN (
    'UPLOAD',
    'S3',
    'DROPBOX',
    'GDRIVE',
    'API_MANIFEST'
  )),
  
  -- Batch status
  status text NOT NULL CHECK (status IN (
    'CREATED',
    'QUEUED',
    'RUNNING',
    'COMPLETE',
    'FAILED',
    'CANCELED'
  )) DEFAULT 'CREATED',
  
  -- Configuration (template, evidence mode, connector path/prefix, etc.)
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Progress tracking
  progress_json jsonb NOT NULL DEFAULT '{
    "total": 0,
    "queued": 0,
    "running": 0,
    "complete": 0,
    "failed": 0
  }'::jsonb,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ingestion_batches_org_id ON public.ingestion_batches(org_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_project_id ON public.ingestion_batches(project_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_status ON public.ingestion_batches(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_source_type ON public.ingestion_batches(source_type);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_created_at ON public.ingestion_batches(created_at DESC);

CREATE TRIGGER trg_ingestion_batches_updated_at
BEFORE UPDATE ON public.ingestion_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. INGESTION BATCH ITEMS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingestion_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.ingestion_batches(id) ON DELETE CASCADE,
  
  -- Item status
  status text NOT NULL CHECK (status IN (
    'PENDING',
    'UPLOADING',
    'READY',
    'PROCESSING',
    'COMPLETE',
    'FAILED',
    'SKIPPED'
  )) DEFAULT 'PENDING',
  
  -- Ingestion mode
  mode text NOT NULL CHECK (mode IN (
    'TRANSCRIPT_ONLY',
    'AUDIO_ONLY',
    'AUDIO_PLUS_TRANSCRIPT'
  )),
  
  -- Item metadata
  title text NOT NULL,
  channel text,
  
  -- Source reference (bucket/key, dropbox path, drive fileId, etc.)
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Job reference (links to existing ingestion_jobs table)
  job_id uuid REFERENCES public.ingestion_jobs(id) ON DELETE SET NULL,
  
  -- Error information
  error_message text,
  
  -- Retry information
  retry_count int NOT NULL DEFAULT 0,
  retry_at timestamptz,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ingestion_batch_items_batch_id ON public.ingestion_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_items_status ON public.ingestion_batch_items(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_items_job_id ON public.ingestion_batch_items(job_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_items_created_at ON public.ingestion_batch_items(created_at DESC);

CREATE TRIGGER trg_ingestion_batch_items_updated_at
BEFORE UPDATE ON public.ingestion_batch_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_batch_items ENABLE ROW LEVEL SECURITY;

-- Ingestion batches: org members can view, ANALYST+ can create
CREATE POLICY "ingestion_batches_select_if_member"
ON public.ingestion_batches FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "ingestion_batches_insert_if_analyst"
ON public.ingestion_batches FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "ingestion_batches_update_if_analyst"
ON public.ingestion_batches FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Ingestion batch items: org members can view (via batch)
CREATE POLICY "ingestion_batch_items_select_if_member"
ON public.ingestion_batch_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.ingestion_batches
    WHERE id = ingestion_batch_items.batch_id
      AND public.is_org_member(org_id)
  )
);

CREATE POLICY "ingestion_batch_items_insert_if_analyst"
ON public.ingestion_batch_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.ingestion_batches
    WHERE id = ingestion_batch_items.batch_id
      AND public.is_org_member(org_id)
  )
  AND public.org_role(
    (SELECT org_id FROM public.ingestion_batches WHERE id = ingestion_batch_items.batch_id)
  ) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "ingestion_batch_items_update_if_analyst"
ON public.ingestion_batch_items FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.ingestion_batches
    WHERE id = ingestion_batch_items.batch_id
      AND public.is_org_member(org_id)
  )
  AND public.org_role(
    (SELECT org_id FROM public.ingestion_batches WHERE id = ingestion_batch_items.batch_id)
  ) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);


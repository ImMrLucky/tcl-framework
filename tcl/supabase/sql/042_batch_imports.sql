-- Batch Import System (SPEC 1)
-- Tracks batch upload imports with per-file results and drilldown

-- ============================================================================
-- 1. INGEST IMPORTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Import type
  type text NOT NULL CHECK (type IN ('BATCH_UPLOAD')) DEFAULT 'BATCH_UPLOAD',
  
  -- Import status
  status text NOT NULL CHECK (status IN (
    'QUEUED',
    'PROCESSING',
    'DONE',
    'PARTIAL',
    'FAILED'
  )) DEFAULT 'QUEUED',
  
  -- Template and configuration
  template_id uuid REFERENCES public.templates(id) ON DELETE SET NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Counts
  total_files int NOT NULL DEFAULT 0,
  parsed_transcripts int NOT NULL DEFAULT 0,
  failed_items int NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ingest_imports_org_id ON public.ingest_imports(org_id);
CREATE INDEX IF NOT EXISTS idx_ingest_imports_status ON public.ingest_imports(status);
CREATE INDEX IF NOT EXISTS idx_ingest_imports_created_at ON public.ingest_imports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_imports_type ON public.ingest_imports(type);

CREATE TRIGGER trg_ingest_imports_updated_at
BEFORE UPDATE ON public.ingest_imports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. INGEST IMPORT ITEMS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.ingest_imports(id) ON DELETE CASCADE,
  
  -- Source file information
  source_name text NOT NULL,
  
  -- Item status
  status text NOT NULL CHECK (status IN (
    'PARSED',
    'FAILED',
    'QUEUED_FOR_ANALYSIS',
    'ANALYZED'
  )) DEFAULT 'PARSED',
  
  -- Resulting conversation (nullable until parsed)
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  
  -- Error information
  error text,
  
  -- Warnings and metadata
  warnings jsonb DEFAULT '[]'::jsonb,
  
  -- Resulting evaluation (nullable until analyzed)
  evaluation_id uuid REFERENCES public.evaluations(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  parsed_at timestamptz,
  analyzed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ingest_import_items_import_id ON public.ingest_import_items(import_id);
CREATE INDEX IF NOT EXISTS idx_ingest_import_items_status ON public.ingest_import_items(status);
CREATE INDEX IF NOT EXISTS idx_ingest_import_items_conversation_id ON public.ingest_import_items(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ingest_import_items_evaluation_id ON public.ingest_import_items(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_ingest_import_items_source_name ON public.ingest_import_items(source_name);

CREATE TRIGGER trg_ingest_import_items_updated_at
BEFORE UPDATE ON public.ingest_import_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

ALTER TABLE public.ingest_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_import_items ENABLE ROW LEVEL SECURITY;

-- Ingest imports: org members can view, ANALYST+ can create
CREATE POLICY "ingest_imports_select_if_member"
ON public.ingest_imports FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "ingest_imports_insert_if_analyst"
ON public.ingest_imports FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "ingest_imports_update_if_analyst"
ON public.ingest_imports FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Ingest import items: org members can view (via import)
CREATE POLICY "ingest_import_items_select_if_member"
ON public.ingest_import_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.ingest_imports
    WHERE id = ingest_import_items.import_id
      AND public.is_org_member(org_id)
  )
);

CREATE POLICY "ingest_import_items_insert_if_analyst"
ON public.ingest_import_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.ingest_imports
    WHERE id = ingest_import_items.import_id
      AND public.is_org_member(org_id)
  )
  AND public.org_role(
    (SELECT org_id FROM public.ingest_imports WHERE id = ingest_import_items.import_id)
  ) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "ingest_import_items_update_if_analyst"
ON public.ingest_import_items FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.ingest_imports
    WHERE id = ingest_import_items.import_id
      AND public.is_org_member(org_id)
  )
  AND public.org_role(
    (SELECT org_id FROM public.ingest_imports WHERE id = ingest_import_items.import_id)
  ) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Comments
COMMENT ON TABLE public.ingest_imports IS 'Tracks batch upload imports with per-file results';
COMMENT ON TABLE public.ingest_import_items IS 'Individual file/item results within a batch import';
COMMENT ON COLUMN public.ingest_import_items.source_name IS 'Original file name or zip entry path';
COMMENT ON COLUMN public.ingest_import_items.warnings IS 'Array of warning messages from parsing';


-- Export Ledger (Section 9)
-- Tracks all exports for audit and defensibility

-- ============================================================================
-- 1. EXPORTS TABLE (Internal downloads tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  
  -- Export metadata
  export_type text NOT NULL CHECK (export_type IN (
    'ISSUE',
    'ISSUES_BULK',
    'CASE',
    'AUDIT_PACK',
    'EVALUATION',
    'CLAIMS'
  )),
  
  -- Target information
  target_id text NOT NULL, -- issue_id, case_id, evaluation_id, etc.
  target_ids text[], -- For bulk exports
  
  -- Export format
  format text NOT NULL CHECK (format IN (
    'CSV',
    'JSON',
    'PDF',
    'ZIP',
    'HTML'
  )),
  
  -- Export preset (for audit packs)
  preset text CHECK (preset IN (
    'AUDIT',
    'LEGAL_HOLD',
    'CUSTOMER_DISPUTE',
    'CUSTOM'
  )),
  
  -- Export metadata
  filename text NOT NULL,
  file_size_bytes bigint,
  checksum text, -- SHA256 hash of exported file
  
  -- Export content summary
  item_count int, -- Number of items exported
  summary_json jsonb, -- Summary statistics
  
  -- Export creator
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exports_org_id ON public.exports(org_id);
CREATE INDEX IF NOT EXISTS idx_exports_project_id ON public.exports(project_id);
CREATE INDEX IF NOT EXISTS idx_exports_export_type ON public.exports(export_type);
CREATE INDEX IF NOT EXISTS idx_exports_target_id ON public.exports(target_id);
CREATE INDEX IF NOT EXISTS idx_exports_created_at ON public.exports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exports_created_by ON public.exports(created_by_user_id);

-- ============================================================================
-- 2. RLS POLICIES
-- ============================================================================

ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

-- Exports: org members can view
CREATE POLICY "exports_select_if_member"
ON public.exports FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "exports_insert_if_member"
ON public.exports FOR INSERT
WITH CHECK (public.is_org_member(org_id));

-- Note: Exports are immutable (no updates/deletes)


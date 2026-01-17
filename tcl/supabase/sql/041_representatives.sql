-- Representatives and Speaker Role Normalization (Section 10)
-- Adds representative attribution and speaker role normalization

-- ============================================================================
-- 1. REPRESENTATIVES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  external_id text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_representatives_org_id ON public.representatives(org_id);
-- Unique index for case-insensitive display_name per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_representatives_org_display_name_unique 
  ON public.representatives(org_id, lower(display_name));
CREATE INDEX IF NOT EXISTS idx_representatives_status ON public.representatives(status) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_representatives_external_id ON public.representatives(external_id) WHERE external_id IS NOT NULL;

-- RLS Policies
ALTER TABLE public.representatives ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view representatives in their org
CREATE POLICY "representatives_select_org"
  ON public.representatives
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = representatives.org_id
      AND org_members.user_id = auth.uid()
    )
  );

-- Policy: Users with ADMIN or OWNER role can insert representatives
CREATE POLICY "representatives_insert_admin"
  ON public.representatives
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = representatives.org_id
      AND org_members.user_id = auth.uid()
      AND org_members.role IN ('ADMIN', 'OWNER')
    )
  );

-- Policy: Users with ADMIN or OWNER role can update representatives
CREATE POLICY "representatives_update_admin"
  ON public.representatives
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.org_id = representatives.org_id
      AND org_members.user_id = auth.uid()
      AND org_members.role IN ('ADMIN', 'OWNER')
    )
  );

-- ============================================================================
-- 2. ADD REPRESENTATIVE_ID COLUMNS
-- ============================================================================

-- Conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS representative_id uuid REFERENCES public.representatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_representative_id ON public.conversations(representative_id);

-- Evaluations
ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS representative_id uuid REFERENCES public.representatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evaluations_representative_id ON public.evaluations(representative_id);

-- Ingestion Jobs
ALTER TABLE public.ingestion_jobs
  ADD COLUMN IF NOT EXISTS representative_id uuid REFERENCES public.representatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_representative_id ON public.ingestion_jobs(representative_id);

-- ============================================================================
-- 3. UPDATE TRIGGERS
-- ============================================================================

-- Update timestamp trigger for representatives
CREATE OR REPLACE FUNCTION update_representatives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER representatives_updated_at
  BEFORE UPDATE ON public.representatives
  FOR EACH ROW
  EXECUTE FUNCTION update_representatives_updated_at();

-- ============================================================================
-- 4. COMMENTS
-- ============================================================================

COMMENT ON TABLE public.representatives IS 'Business-level representative identity (employees) for analytics and attribution';
COMMENT ON COLUMN public.representatives.display_name IS 'Human-readable name (e.g., "Vanessa Smith")';
COMMENT ON COLUMN public.representatives.external_id IS 'Optional external system ID for syncing';
COMMENT ON COLUMN public.representatives.status IS 'ACTIVE or INACTIVE';

COMMENT ON COLUMN public.conversations.representative_id IS 'Optional link to representative for analytics';
COMMENT ON COLUMN public.evaluations.representative_id IS 'Propagated from conversation for fast filtering';
COMMENT ON COLUMN public.ingestion_jobs.representative_id IS 'Default representative for batch ingestion';


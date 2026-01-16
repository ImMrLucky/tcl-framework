-- Issue Signoffs System (Phase 3)
-- Enables enterprise review sign-off workflow for issue decisions

-- ============================================================================
-- 1. ISSUE SIGNOFFS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.issue_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.issue_decisions(id) ON DELETE CASCADE,
  
  -- Signoff role
  role text NOT NULL CHECK (role IN (
    'QA',
    'COMPLIANCE',
    'LEGAL',
    'MANAGER'
  )),
  
  -- Signoff details
  signed_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  
  -- Unique constraint: one signoff per role per decision
  UNIQUE(decision_id, role)
);

CREATE INDEX IF NOT EXISTS idx_issue_signoffs_org_id ON public.issue_signoffs(org_id);
CREATE INDEX IF NOT EXISTS idx_issue_signoffs_decision_id ON public.issue_signoffs(decision_id);
CREATE INDEX IF NOT EXISTS idx_issue_signoffs_role ON public.issue_signoffs(role);
CREATE INDEX IF NOT EXISTS idx_issue_signoffs_signed_by ON public.issue_signoffs(signed_by_user_id);

-- ============================================================================
-- 2. ORG SETTINGS TABLE (for signoff requirements)
-- ============================================================================

-- Add signoff requirement setting to org_settings if it doesn't exist
-- We'll check if org_settings table exists and add the column if needed
DO $$
BEGIN
  -- Check if org_settings table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'org_settings') THEN
    -- Add column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'org_settings' 
      AND column_name = 'require_compliance_signoff_on_high_severity'
    ) THEN
      ALTER TABLE public.org_settings
      ADD COLUMN require_compliance_signoff_on_high_severity boolean NOT NULL DEFAULT false;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

ALTER TABLE public.issue_signoffs ENABLE ROW LEVEL SECURITY;

-- Issue signoffs: org members can view, ANALYST+ can create
CREATE POLICY "issue_signoffs_select_if_member"
ON public.issue_signoffs FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "issue_signoffs_insert_if_analyst"
ON public.issue_signoffs FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Signoffs are immutable (no updates/deletes) - only create new ones
-- If revoke is needed, add a "revoked" event to decision_events instead

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function to get signoffs for a decision
CREATE OR REPLACE FUNCTION public.get_decision_signoffs(p_decision_id uuid)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  decision_id uuid,
  role text,
  signed_by_user_id uuid,
  signed_at timestamptz,
  note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.org_id,
    s.decision_id,
    s.role,
    s.signed_by_user_id,
    s.signed_at,
    s.note
  FROM public.issue_signoffs s
  WHERE s.decision_id = p_decision_id
  ORDER BY s.signed_at ASC;
$$;

-- Function to check if a decision has all required signoffs
CREATE OR REPLACE FUNCTION public.decision_has_required_signoffs(
  p_decision_id uuid,
  p_org_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision_disposition text;
  v_issue_severity text;
  v_require_compliance boolean;
  v_has_compliance_signoff boolean;
BEGIN
  -- Get decision and issue details
  SELECT 
    d.disposition,
    -- Get issue severity from the evaluation report (would need to join with evaluations)
    -- For now, we'll check if compliance signoff is required based on org setting
    NULL -- Placeholder for issue severity
  INTO v_decision_disposition, v_issue_severity
  FROM public.issue_decisions d
  WHERE d.id = p_decision_id
    AND d.org_id = p_org_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Check org setting for compliance signoff requirement
  SELECT COALESCE(
    (SELECT require_compliance_signoff_on_high_severity 
     FROM public.org_settings 
     WHERE org_id = p_org_id),
    false
  ) INTO v_require_compliance;
  
  -- If compliance signoff is required, check if it exists
  IF v_require_compliance THEN
    SELECT EXISTS(
      SELECT 1 FROM public.issue_signoffs
      WHERE decision_id = p_decision_id
        AND role = 'COMPLIANCE'
    ) INTO v_has_compliance_signoff;
    
    IF NOT v_has_compliance_signoff THEN
      RETURN false;
    END IF;
  END IF;
  
  -- For now, return true if compliance signoff requirement is met (or not required)
  -- Can be extended to check other required signoffs based on org policy
  RETURN true;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_decision_signoffs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decision_has_required_signoffs(uuid, uuid) TO authenticated;


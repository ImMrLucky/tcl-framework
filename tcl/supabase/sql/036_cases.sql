-- Cases System (Phase 3)
-- Enables enterprise case management for grouping related issues

-- ============================================================================
-- 1. CASES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  
  -- Case details
  title text NOT NULL,
  description text,
  
  -- Case status
  status text NOT NULL CHECK (status IN (
    'OPEN',
    'IN_REVIEW',
    'CLOSED'
  )) DEFAULT 'OPEN',
  
  -- Case ownership
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_org_id ON public.cases(org_id);
CREATE INDEX IF NOT EXISTS idx_cases_project_id ON public.cases(project_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON public.cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_owner ON public.cases(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON public.cases(created_at DESC);

CREATE TRIGGER trg_cases_updated_at
BEFORE UPDATE ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. CASE ISSUES TABLE (Many-to-many relationship)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.case_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  
  -- Issue reference (using deterministic issue_id, not evaluation-specific)
  issue_id text NOT NULL,
  
  -- Evaluation context (optional, for tracking which evaluation this issue came from)
  evaluation_id uuid REFERENCES public.evaluations(id) ON DELETE SET NULL,
  
  -- Audit fields
  added_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  
  -- Unique constraint: prevent duplicate issue additions to same case
  -- Note: Same issue can be in multiple cases, but only once per case
  UNIQUE(case_id, issue_id, evaluation_id)
);

CREATE INDEX IF NOT EXISTS idx_case_issues_case_id ON public.case_issues(case_id);
CREATE INDEX IF NOT EXISTS idx_case_issues_issue_id ON public.case_issues(issue_id);
CREATE INDEX IF NOT EXISTS idx_case_issues_evaluation_id ON public.case_issues(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_case_issues_added_by ON public.case_issues(added_by_user_id);

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_issues ENABLE ROW LEVEL SECURITY;

-- Cases: org members can view, ANALYST+ can create/update
CREATE POLICY "cases_select_if_member"
ON public.cases FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "cases_insert_if_analyst"
ON public.cases FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "cases_update_if_analyst"
ON public.cases FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Case issues: org members can view, ANALYST+ can add/remove
CREATE POLICY "case_issues_select_if_member"
ON public.case_issues FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = case_issues.case_id
      AND public.is_org_member(org_id)
  )
);

CREATE POLICY "case_issues_insert_if_analyst"
ON public.case_issues FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = case_issues.case_id
      AND public.is_org_member(org_id)
  )
  AND public.org_role(
    (SELECT org_id FROM public.cases WHERE id = case_issues.case_id)
  ) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "case_issues_delete_if_analyst"
ON public.case_issues FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = case_issues.case_id
      AND public.is_org_member(org_id)
  )
  AND public.org_role(
    (SELECT org_id FROM public.cases WHERE id = case_issues.case_id)
  ) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function to get case with issue count
CREATE OR REPLACE FUNCTION public.get_case_with_issue_count(p_case_id uuid)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  project_id uuid,
  title text,
  description text,
  status text,
  owner_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  issue_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.org_id,
    c.project_id,
    c.title,
    c.description,
    c.status,
    c.owner_user_id,
    c.created_at,
    c.updated_at,
    COUNT(ci.id)::bigint as issue_count
  FROM public.cases c
  LEFT JOIN public.case_issues ci ON ci.case_id = c.id
  WHERE c.id = p_case_id
  GROUP BY c.id, c.org_id, c.project_id, c.title, c.description, c.status, c.owner_user_id, c.created_at, c.updated_at;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_case_with_issue_count(uuid) TO authenticated;


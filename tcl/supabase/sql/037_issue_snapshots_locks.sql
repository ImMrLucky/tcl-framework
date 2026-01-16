-- Issue Snapshots & Locks System (Phase 4)
-- Enables enterprise legal hold and audit defensibility

-- ============================================================================
-- 1. ISSUE SNAPSHOTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.issue_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  evaluation_id uuid NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  issue_id text NOT NULL, -- Deterministic issue ID
  
  -- Snapshot payload (full issue state at time of snapshot)
  snapshot_json jsonb NOT NULL,
  
  -- Defensibility hashes
  evidence_set_hash text,
  input_hash text,
  engine_version text,
  
  -- Audit fields
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
  
  -- Note: Multiple snapshots allowed per issue per evaluation
  -- If you want only one snapshot per issue per evaluation, add:
  -- UNIQUE(org_id, issue_id, evaluation_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_snapshots_org_id ON public.issue_snapshots(org_id);
CREATE INDEX IF NOT EXISTS idx_issue_snapshots_issue_id ON public.issue_snapshots(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_snapshots_evaluation_id ON public.issue_snapshots(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_issue_snapshots_created_at ON public.issue_snapshots(created_at DESC);

-- ============================================================================
-- 2. ISSUE LOCKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.issue_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  issue_id text NOT NULL, -- Deterministic issue ID
  
  -- Lock status
  status text NOT NULL CHECK (status IN ('LOCKED', 'UNLOCKED')) DEFAULT 'LOCKED',
  
  -- Lock details
  locked_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_at timestamptz NOT NULL DEFAULT now(),
  unlocked_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unlocked_at timestamptz,
  reason text,
  
  -- Snapshot reference (snapshot created when locked)
  snapshot_id uuid REFERENCES public.issue_snapshots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_issue_locks_org_id ON public.issue_locks(org_id);
CREATE INDEX IF NOT EXISTS idx_issue_locks_issue_id ON public.issue_locks(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_locks_status ON public.issue_locks(status);
CREATE INDEX IF NOT EXISTS idx_issue_locks_locked_at ON public.issue_locks(locked_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_locks_snapshot_id ON public.issue_locks(snapshot_id);

-- Partial unique index: one active lock per issue per org
-- This allows multiple lock/unlock cycles (historical records)
CREATE UNIQUE INDEX IF NOT EXISTS issue_locks_active_lock_uidx
  ON public.issue_locks(org_id, issue_id)
  WHERE status = 'LOCKED';

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

ALTER TABLE public.issue_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_locks ENABLE ROW LEVEL SECURITY;

-- Issue snapshots: org members can view, ANALYST+ can create
CREATE POLICY "issue_snapshots_select_if_member"
ON public.issue_snapshots FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "issue_snapshots_insert_if_analyst"
ON public.issue_snapshots FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Snapshots are immutable (no updates/deletes)

-- Issue locks: org members can view, ANALYST+ can create/update
CREATE POLICY "issue_locks_select_if_member"
ON public.issue_locks FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "issue_locks_insert_if_analyst"
ON public.issue_locks FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "issue_locks_update_if_analyst"
ON public.issue_locks FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function to get active lock for an issue
CREATE OR REPLACE FUNCTION public.get_issue_lock(
  p_org_id uuid,
  p_issue_id text
)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  issue_id text,
  status text,
  locked_by_user_id uuid,
  locked_at timestamptz,
  unlocked_by_user_id uuid,
  unlocked_at timestamptz,
  reason text,
  snapshot_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.org_id,
    l.issue_id,
    l.status,
    l.locked_by_user_id,
    l.locked_at,
    l.unlocked_by_user_id,
    l.unlocked_at,
    l.reason,
    l.snapshot_id
  FROM public.issue_locks l
  WHERE l.org_id = p_org_id
    AND l.issue_id = p_issue_id
    AND l.status = 'LOCKED'
  ORDER BY l.locked_at DESC
  LIMIT 1;
$$;

-- Function to get snapshots for an issue
CREATE OR REPLACE FUNCTION public.get_issue_snapshots(
  p_org_id uuid,
  p_issue_id text
)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  project_id uuid,
  evaluation_id uuid,
  issue_id text,
  snapshot_json jsonb,
  evidence_set_hash text,
  input_hash text,
  engine_version text,
  created_by_user_id uuid,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.org_id,
    s.project_id,
    s.evaluation_id,
    s.issue_id,
    s.snapshot_json,
    s.evidence_set_hash,
    s.input_hash,
    s.engine_version,
    s.created_by_user_id,
    s.created_at
  FROM public.issue_snapshots s
  WHERE s.org_id = p_org_id
    AND s.issue_id = p_issue_id
  ORDER BY s.created_at DESC;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_issue_lock(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_issue_snapshots(uuid, text) TO authenticated;


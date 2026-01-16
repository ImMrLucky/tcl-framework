-- Issue Decisions System (Phase 2)
-- Enables enterprise issue disposition tracking and decision history

-- ============================================================================
-- 1. ISSUE DECISIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.issue_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  evaluation_id uuid REFERENCES public.evaluations(id) ON DELETE SET NULL,
  
  -- Deterministic issue identifier (stable across reruns)
  issue_id text NOT NULL,
  
  -- Decision fields
  disposition text NOT NULL CHECK (disposition IN (
    'OPEN',
    'ACKNOWLEDGED',
    'REMEDIATED',
    'ACCEPTED_RISK',
    'FALSE_POSITIVE',
    'REQUIRES_FOLLOWUP',
    'ESCALATED'
  )),
  
  severity_override text CHECK (severity_override IN ('critical', 'high', 'medium', 'low')),
  assigned_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  expires_at timestamptz, -- Required when disposition=ACCEPTED_RISK
  
  -- Audit fields
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Unique constraint: one decision per issue per org
  -- This allows the same issue_id to exist across different evaluations but only one active decision per org
  UNIQUE(org_id, issue_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_decisions_org_id ON public.issue_decisions(org_id);
CREATE INDEX IF NOT EXISTS idx_issue_decisions_issue_id ON public.issue_decisions(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_decisions_evaluation_id ON public.issue_decisions(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_issue_decisions_disposition ON public.issue_decisions(disposition);
CREATE INDEX IF NOT EXISTS idx_issue_decisions_assigned_to ON public.issue_decisions(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_issue_decisions_expires_at ON public.issue_decisions(expires_at) WHERE expires_at IS NOT NULL;

CREATE TRIGGER trg_issue_decisions_updated_at
BEFORE UPDATE ON public.issue_decisions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. ISSUE DECISION EVENTS TABLE (Append-only audit log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.issue_decision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.issue_decisions(id) ON DELETE CASCADE,
  
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED',
    'UPDATED',
    'COMMENTED',
    'SIGNED_OFF',
    'LOCKED',
    'UNLOCKED'
  )),
  
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_decision_events_decision_id ON public.issue_decision_events(decision_id);
CREATE INDEX IF NOT EXISTS idx_issue_decision_events_actor ON public.issue_decision_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_issue_decision_events_created_at ON public.issue_decision_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_decision_events_event_type ON public.issue_decision_events(event_type);

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

ALTER TABLE public.issue_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_decision_events ENABLE ROW LEVEL SECURITY;

-- Issue decisions: org members can view, ANALYST+ can create/update
CREATE POLICY "issue_decisions_select_if_member"
ON public.issue_decisions FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "issue_decisions_insert_if_analyst"
ON public.issue_decisions FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

CREATE POLICY "issue_decisions_update_if_analyst"
ON public.issue_decisions FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Issue decision events: org members can view
CREATE POLICY "issue_decision_events_select_if_member"
ON public.issue_decision_events FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.issue_decisions
    WHERE id = issue_decision_events.decision_id
      AND public.is_org_member(org_id)
  )
);

CREATE POLICY "issue_decision_events_insert_if_member"
ON public.issue_decision_events FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.issue_decisions
    WHERE id = issue_decision_events.decision_id
      AND public.is_org_member(org_id)
  )
);

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function to check if ACCEPTED_RISK has expired
CREATE OR REPLACE FUNCTION public.issue_decision_is_expired(p_decision_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.issue_decisions
    WHERE id = p_decision_id
      AND disposition = 'ACCEPTED_RISK'
      AND expires_at IS NOT NULL
      AND expires_at < now()
  );
$$;

-- Function to get decision for an issue
CREATE OR REPLACE FUNCTION public.get_issue_decision(
  p_org_id uuid,
  p_issue_id text
)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  project_id uuid,
  evaluation_id uuid,
  issue_id text,
  disposition text,
  severity_override text,
  assigned_to_user_id uuid,
  notes text,
  expires_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.org_id,
    d.project_id,
    d.evaluation_id,
    d.issue_id,
    d.disposition,
    d.severity_override,
    d.assigned_to_user_id,
    d.notes,
    d.expires_at,
    d.created_by_user_id,
    d.created_at,
    d.updated_at
  FROM public.issue_decisions d
  WHERE d.org_id = p_org_id
    AND d.issue_id = p_issue_id;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.issue_decision_is_expired(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_issue_decision(uuid, text) TO authenticated;

-- ============================================================================
-- 5. CONSTRAINT: Require expires_at when disposition is ACCEPTED_RISK
-- ============================================================================

-- Add check constraint to ensure expires_at is set for ACCEPTED_RISK
ALTER TABLE public.issue_decisions
ADD CONSTRAINT issue_decisions_accepted_risk_requires_expiry
CHECK (
  (disposition = 'ACCEPTED_RISK' AND expires_at IS NOT NULL)
  OR (disposition != 'ACCEPTED_RISK')
);


-- Agent Studio: runner auth hardening, context summaries, patch proposals.

ALTER TABLE public.agent_studio_local_runners
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS runner_auth_token_hash text,
  ADD COLUMN IF NOT EXISTS runner_session_token_hash text,
  ADD COLUMN IF NOT EXISTS runner_session_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_session_rotated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.agent_studio_team_context_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  team_run_id uuid REFERENCES public.agent_studio_team_runs(id) ON DELETE SET NULL,

  summary text NOT NULL DEFAULT '',
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_statuses jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,

  last_event_sequence bigint,
  generated_by_agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(team_id)
);

CREATE TRIGGER trg_agent_studio_team_context_summaries_updated_at
BEFORE UPDATE ON public.agent_studio_team_context_summaries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.agent_studio_patch_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  team_run_id uuid REFERENCES public.agent_studio_team_runs(id) ON DELETE SET NULL,
  agent_run_id uuid REFERENCES public.agent_studio_agent_runs(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,

  title text NOT NULL,
  summary text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  unified_diff text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'APPLIED', 'SUPERSEDED')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_agent_studio_patch_proposals_updated_at
BEFORE UPDATE ON public.agent_studio_patch_proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_agent_studio_patch_proposals_team
  ON public.agent_studio_patch_proposals(team_id, status);

ALTER TABLE public.agent_studio_team_context_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_studio_patch_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_studio_team_context_summaries_select" ON public.agent_studio_team_context_summaries;
DROP POLICY IF EXISTS "agent_studio_team_context_summaries_write" ON public.agent_studio_team_context_summaries;
DROP POLICY IF EXISTS "agent_studio_patch_proposals_select" ON public.agent_studio_patch_proposals;
DROP POLICY IF EXISTS "agent_studio_patch_proposals_write" ON public.agent_studio_patch_proposals;

CREATE POLICY "agent_studio_team_context_summaries_select" ON public.agent_studio_team_context_summaries FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_team_context_summaries_write" ON public.agent_studio_team_context_summaries FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'));

CREATE POLICY "agent_studio_patch_proposals_select" ON public.agent_studio_patch_proposals FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_patch_proposals_write" ON public.agent_studio_patch_proposals FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'));

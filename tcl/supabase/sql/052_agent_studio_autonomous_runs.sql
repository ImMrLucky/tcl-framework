-- Agent Studio: autonomous team runs, agent runs, JSONL event log, local runners.

-- ----------------------------------------------------------------------------
-- Team runs (orchestrated autonomous execution)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_team_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Team Run',
  objective text NOT NULL,
  run_mode text NOT NULL DEFAULT 'RUN_UNTIL_BLOCKED'
    CHECK (run_mode IN (
      'MANUAL', 'ONE_STEP', 'RUN_UNTIL_BLOCKED', 'RUN_UNTIL_REVIEW', 'RUN_UNTIL_DONE', 'CONTINUOUS'
    )),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN (
      'QUEUED', 'RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'WAITING_FOR_REVIEW',
      'BLOCKED', 'SUCCEEDED', 'FAILED', 'CANCELLED'
    )),
  orchestrator_agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  max_steps integer NOT NULL DEFAULT 25,
  completed_steps integer NOT NULL DEFAULT 0,
  local_runner_id uuid,
  local_runner_session_id text,
  last_heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_team_runs_team ON public.agent_studio_team_runs(team_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_studio_team_runs_org ON public.agent_studio_team_runs(org_id);

CREATE TRIGGER trg_agent_studio_team_runs_updated_at
BEFORE UPDATE ON public.agent_studio_team_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Agent runs (single agent execution within a team run)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_run_id uuid REFERENCES public.agent_studio_team_runs(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agent_studio_agents(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  use_case text NOT NULL DEFAULT 'chat',
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN (
      'QUEUED', 'RUNNING', 'WAITING_FOR_TOOL', 'WAITING_FOR_REVIEW', 'WAITING_FOR_HUMAN',
      'BLOCKED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PAUSED'
    )),
  provider text,
  model text,
  local_provider_ref text,
  prompt_preview text,
  output text,
  error text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_agent_runs_team_run ON public.agent_studio_agent_runs(team_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_agent_runs_agent ON public.agent_studio_agent_runs(agent_id, status);

-- ----------------------------------------------------------------------------
-- Run steps (audit trail per orchestration tick)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_run_id uuid REFERENCES public.agent_studio_team_runs(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES public.agent_studio_agent_runs(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  step_index integer NOT NULL DEFAULT 0,
  step_type text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_agent_run_steps_team_run
  ON public.agent_studio_agent_run_steps(team_run_id, step_index);

-- ----------------------------------------------------------------------------
-- Shared team JSONL-style event log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_team_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  team_run_id uuid REFERENCES public.agent_studio_team_runs(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  sequence bigint GENERATED BY DEFAULT AS IDENTITY,
  event_type text NOT NULL,
  actor_type text NOT NULL DEFAULT 'SYSTEM'
    CHECK (actor_type IN ('SYSTEM', 'USER', 'AGENT', 'JARVIS', 'LOCAL_RUNNER')),
  actor_name text,
  summary text NOT NULL,
  jsonl jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_team_event_log_team_seq
  ON public.agent_studio_team_event_log(team_id, sequence DESC);

-- ----------------------------------------------------------------------------
-- Per-agent private context (not shared JSONL)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_agent_private_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agent_studio_agents(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  current_task_id uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by_agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id)
);

CREATE TRIGGER trg_agent_studio_agent_private_context_updated_at
BEFORE UPDATE ON public.agent_studio_agent_private_context
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Local runners (execution plane pairing — no plaintext keys on server)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_local_runners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  device_label text,
  pairing_code_hash text,
  runner_public_key text,
  status text NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'PAIRED', 'ONLINE', 'OFFLINE', 'REVOKED', 'ERROR')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_agent_studio_local_runners_updated_at
BEFORE UPDATE ON public.agent_studio_local_runners
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Local vendor refs (metadata only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_local_vendor_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  local_runner_id uuid REFERENCES public.agent_studio_local_runners(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text NOT NULL,
  local_key_ref text NOT NULL,
  key_preview text,
  status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (status IN ('UNKNOWN', 'READY', 'MISSING', 'INVALID', 'DISABLED')),
  supported_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, local_runner_id, provider, label)
);

CREATE TRIGGER trg_agent_studio_local_vendor_refs_updated_at
BEFORE UPDATE ON public.agent_studio_local_vendor_refs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- FK local_runner on team_runs (after table exists)
ALTER TABLE public.agent_studio_team_runs
  DROP CONSTRAINT IF EXISTS agent_studio_team_runs_local_runner_id_fkey;
ALTER TABLE public.agent_studio_team_runs
  ADD CONSTRAINT agent_studio_team_runs_local_runner_id_fkey
  FOREIGN KEY (local_runner_id) REFERENCES public.agent_studio_local_runners(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.agent_studio_team_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_studio_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_studio_agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_studio_team_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_studio_agent_private_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_studio_local_runners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_studio_local_vendor_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_team_runs_select" ON public.agent_studio_team_runs FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_team_runs_write" ON public.agent_studio_team_runs FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'));

CREATE POLICY "agent_studio_agent_runs_select" ON public.agent_studio_agent_runs FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_agent_runs_write" ON public.agent_studio_agent_runs FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'));

CREATE POLICY "agent_studio_agent_run_steps_select" ON public.agent_studio_agent_run_steps FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_agent_run_steps_write" ON public.agent_studio_agent_run_steps FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'));

CREATE POLICY "agent_studio_team_event_log_select" ON public.agent_studio_team_event_log FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_team_event_log_insert" ON public.agent_studio_team_event_log FOR INSERT
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'));

CREATE POLICY "agent_studio_agent_private_context_select" ON public.agent_studio_agent_private_context FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_agent_private_context_write" ON public.agent_studio_agent_private_context FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER','ANALYST'));

CREATE POLICY "agent_studio_local_runners_select" ON public.agent_studio_local_runners FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_local_runners_write" ON public.agent_studio_local_runners FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER'));

CREATE POLICY "agent_studio_local_vendor_refs_select" ON public.agent_studio_local_vendor_refs FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY "agent_studio_local_vendor_refs_write" ON public.agent_studio_local_vendor_refs FOR ALL
  USING (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER'))
  WITH CHECK (public.is_org_member(org_id) AND public.org_role(org_id) IN ('OWNER','ADMIN','MANAGER'));

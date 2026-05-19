-- Agent Studio: TCL analysis sessions (engine at the heart of agent work).

CREATE TABLE IF NOT EXISTS public.agent_studio_tcl_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES public.agent_studio_agent_runs(id) ON DELETE SET NULL,
  team_run_id uuid REFERENCES public.agent_studio_team_runs(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  trigger text NOT NULL DEFAULT 'MANUAL'
    CHECK (trigger IN (
      'AGENT_RUN_COMPLETE', 'MANUAL', 'IDE_DISPATCH', 'JARVIS_STEP', 'TEAM_EVENT'
    )),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_tcl_analyses_team
  ON public.agent_studio_tcl_analyses(team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_studio_tcl_analyses_agent_run
  ON public.agent_studio_tcl_analyses(agent_run_id)
  WHERE agent_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_studio_tcl_analyses_org
  ON public.agent_studio_tcl_analyses(org_id, created_at DESC);

ALTER TABLE public.agent_studio_agent_runs
  ADD COLUMN IF NOT EXISTS tcl_analysis_id uuid
  REFERENCES public.agent_studio_tcl_analyses(id) ON DELETE SET NULL;

COMMENT ON TABLE public.agent_studio_tcl_analyses IS
  'TCL engine runs on agent-studio artifacts (task + output + sources). Powers in-app insights and tcl-browser-runner.';

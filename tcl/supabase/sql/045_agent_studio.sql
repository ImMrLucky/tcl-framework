-- ============================================================================
-- Agent Studio (ProtectQA Agent Developer Platform) — MVP foundation
--
-- Spec:           docs/specs/agent-studio.md
-- Implementation: docs/agent-studio/implementation-progress.md
--
-- Notes:
-- * Reuses existing TCL tenancy: organizations, projects, org_members,
--   org_role(uuid), is_org_member(uuid).
-- * BYOK provider keys are stored in `agent_studio_provider_keys` with the
--   secret material encrypted at the application layer (AES-256-GCM via
--   AGENT_STUDIO_ENC_KEY). The `*_ciphertext` / `*_iv` / `*_tag` columns are
--   raw ciphertext bytes; we never store plaintext credentials.
-- * Pause is first-class on org / team / agent rows — orchestrator gateway
--   reads these, not just the UI.
-- * Audit log is intentionally separate from the platform-wide `audit_logs`
--   table so Agent Studio can evolve its event shape independently.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Org-level Agent Studio settings (global pause + plan flag).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_orgs (
  org_id          uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT false,
  paused_at       timestamptz,
  paused_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pause_reason    text,
  default_model   text,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_agent_studio_orgs_updated_at
BEFORE UPDATE ON public.agent_studio_orgs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_orgs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_orgs_select_if_member"
ON public.agent_studio_orgs FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_orgs_update_if_admin"
ON public.agent_studio_orgs FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

CREATE POLICY "agent_studio_orgs_insert_if_admin"
ON public.agent_studio_orgs FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

-- ----------------------------------------------------------------------------
-- 2. Teams.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name            text NOT NULL,
  description     text,
  workflow_template_key text,            -- e.g. 'bmad_full_sdlc' (see agent-core templates)
  paused_at       timestamptz,
  paused_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pause_reason    text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_teams_org ON public.agent_studio_teams(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_teams_project ON public.agent_studio_teams(project_id);

CREATE TRIGGER trg_agent_studio_teams_updated_at
BEFORE UPDATE ON public.agent_studio_teams
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_teams_select_if_member"
ON public.agent_studio_teams FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_teams_write_if_manager"
ON public.agent_studio_teams FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

-- ----------------------------------------------------------------------------
-- 3. Agents (one Agent Manager per team + N specialists).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_agents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  name            text NOT NULL,
  role_template_key text,                 -- e.g. 'senior_software_engineer'
  is_orchestrator boolean NOT NULL DEFAULT false,
  persona         text,
  status          text NOT NULL DEFAULT 'IDLE' CHECK (status IN (
    'IDLE','BUSY','WAITING_REVIEW','PAUSED','ERROR'
  )),
  theme           jsonb NOT NULL DEFAULT '{}'::jsonb,        -- avatar, color, badge, etc.
  capabilities    jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools           jsonb NOT NULL DEFAULT '[]'::jsonb,
  paused_at       timestamptz,
  paused_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pause_reason    text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_agents_team ON public.agent_studio_agents(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_agents_org ON public.agent_studio_agents(org_id);

-- Only one orchestrator per team.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_team_orchestrator
ON public.agent_studio_agents(team_id)
WHERE is_orchestrator = true;

CREATE TRIGGER trg_agent_studio_agents_updated_at
BEFORE UPDATE ON public.agent_studio_agents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_agents_select_if_member"
ON public.agent_studio_agents FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_agents_write_if_manager"
ON public.agent_studio_agents FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

-- ----------------------------------------------------------------------------
-- 4. Agent config (per-agent JSON/YAML-ish config blob, versioned).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_agent_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES public.agent_studio_agents(id) ON DELETE CASCADE,
  version         integer NOT NULL DEFAULT 1,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_agent_configs_agent
ON public.agent_studio_agent_configs(agent_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_agent_active_config
ON public.agent_studio_agent_configs(agent_id)
WHERE is_active = true;

ALTER TABLE public.agent_studio_agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_agent_configs_select_if_member"
ON public.agent_studio_agent_configs FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_agent_configs_write_if_manager"
ON public.agent_studio_agent_configs FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

-- ----------------------------------------------------------------------------
-- 5. Kanban board + columns + tasks.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_boards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Default Board',
  columns         jsonb NOT NULL DEFAULT '[
    {"key":"backlog","label":"Backlog"},
    {"key":"todo","label":"To Do"},
    {"key":"in_progress","label":"In Progress"},
    {"key":"review","label":"Review"},
    {"key":"done","label":"Done"}
  ]'::jsonb,
  is_default      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_boards_team ON public.agent_studio_boards(team_id);

CREATE TRIGGER trg_agent_studio_boards_updated_at
BEFORE UPDATE ON public.agent_studio_boards
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_boards_select_if_member"
ON public.agent_studio_boards FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_boards_write_if_manager"
ON public.agent_studio_boards FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

CREATE TABLE IF NOT EXISTS public.agent_studio_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  board_id        uuid NOT NULL REFERENCES public.agent_studio_boards(id) ON DELETE CASCADE,
  column_key      text NOT NULL DEFAULT 'backlog',
  position        integer NOT NULL DEFAULT 0,
  title           text NOT NULL,
  description     text,
  task_type       text NOT NULL DEFAULT 'STORY' CHECK (task_type IN (
    'STORY','BUG','SPIKE','RESEARCH','SPEC','REVIEW','CHORE'
  )),
  priority        text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN (
    'LOW','MEDIUM','HIGH','CRITICAL'
  )),
  status          text NOT NULL DEFAULT 'PLANNED' CHECK (status IN (
    'PLANNED','IN_PROGRESS','BLOCKED','REVIEW','DONE','CANCELLED'
  )),
  assigned_agent_id uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_ref    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {jira_key,...}
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_tasks_board ON public.agent_studio_tasks(board_id, column_key, position);
CREATE INDEX IF NOT EXISTS idx_agent_studio_tasks_team ON public.agent_studio_tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_tasks_assigned ON public.agent_studio_tasks(assigned_agent_id);

CREATE TRIGGER trg_agent_studio_tasks_updated_at
BEFORE UPDATE ON public.agent_studio_tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_tasks_select_if_member"
ON public.agent_studio_tasks FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_tasks_write_if_analyst"
ON public.agent_studio_tasks FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ----------------------------------------------------------------------------
-- 6. Review gates (human-in-the-loop checkpoints).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_review_gates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id         uuid NOT NULL REFERENCES public.agent_studio_tasks(id) ON DELETE CASCADE,
  gate_type       text NOT NULL CHECK (gate_type IN (
    'SPEC_REVIEW','CODE_REVIEW','SECURITY_REVIEW','QA_REVIEW','RELEASE_APPROVAL','CUSTOM'
  )),
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','APPROVED','CHANGES_REQUESTED','REJECTED','SKIPPED'
  )),
  required_role   text,                                 -- e.g. 'OWNER' or 'ANALYST'
  comment         text,
  decided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_review_gates_task ON public.agent_studio_review_gates(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_review_gates_status ON public.agent_studio_review_gates(status);

CREATE TRIGGER trg_agent_studio_review_gates_updated_at
BEFORE UPDATE ON public.agent_studio_review_gates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_review_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_review_gates_select_if_member"
ON public.agent_studio_review_gates FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_review_gates_write_if_analyst"
ON public.agent_studio_review_gates FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ----------------------------------------------------------------------------
-- 7. Shared team context + per-agent context.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_contexts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope           text NOT NULL CHECK (scope IN ('TEAM','AGENT')),
  team_id         uuid REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES public.agent_studio_agents(id) ON DELETE CASCADE,
  key             text NOT NULL,
  content         text,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  pinned          boolean NOT NULL DEFAULT false,
  source          text,                                 -- 'manual' | 'agent' | 'workflow'
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_studio_contexts_scope_chk CHECK (
    (scope = 'TEAM'  AND team_id  IS NOT NULL AND agent_id IS NULL) OR
    (scope = 'AGENT' AND agent_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_contexts_team ON public.agent_studio_contexts(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_contexts_agent ON public.agent_studio_contexts(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_contexts_key ON public.agent_studio_contexts(key);

CREATE TRIGGER trg_agent_studio_contexts_updated_at
BEFORE UPDATE ON public.agent_studio_contexts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_contexts_select_if_member"
ON public.agent_studio_contexts FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_contexts_write_if_analyst"
ON public.agent_studio_contexts FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ----------------------------------------------------------------------------
-- 8. Mistake / rule registry (team or agent scoped learning).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_mistakes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  scope           text NOT NULL CHECK (scope IN ('TEAM','AGENT')),
  title           text NOT NULL,
  description     text,
  rule            text NOT NULL,                          -- the corrective rule to apply going forward
  severity        text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  source_task_id  uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_mistakes_team ON public.agent_studio_mistakes(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_mistakes_agent ON public.agent_studio_mistakes(agent_id);

CREATE TRIGGER trg_agent_studio_mistakes_updated_at
BEFORE UPDATE ON public.agent_studio_mistakes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_mistakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_mistakes_select_if_member"
ON public.agent_studio_mistakes FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_mistakes_write_if_analyst"
ON public.agent_studio_mistakes FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ----------------------------------------------------------------------------
-- 9. BYOK provider keys — encrypted at rest (AES-256-GCM at app layer).
--    Schema only stores ciphertext / IV / tag. Never plaintext.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_provider_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN (
    'openai','anthropic','google','azure-openai','mistral','groq','ollama','custom'
  )),
  label           text NOT NULL,
  key_ciphertext  bytea NOT NULL,
  key_iv          bytea NOT NULL,
  key_tag         bytea NOT NULL,
  key_alg         text NOT NULL DEFAULT 'aes-256-gcm',
  key_version     integer NOT NULL DEFAULT 1,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,    -- e.g. base url, region, project id (non-secret)
  is_active       boolean NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_provider_keys_org ON public.agent_studio_provider_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_provider_keys_team ON public.agent_studio_provider_keys(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_provider_keys_label
ON public.agent_studio_provider_keys(org_id, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, label);

CREATE TRIGGER trg_agent_studio_provider_keys_updated_at
BEFORE UPDATE ON public.agent_studio_provider_keys
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_provider_keys ENABLE ROW LEVEL SECURITY;

-- We deliberately DO NOT allow direct read of secret bytes via RLS — backend
-- always uses the service role to decrypt and only returns redacted views.
-- For non-secret listing, only metadata is selected.
CREATE POLICY "agent_studio_provider_keys_select_if_admin"
ON public.agent_studio_provider_keys FOR SELECT
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

CREATE POLICY "agent_studio_provider_keys_write_if_admin"
ON public.agent_studio_provider_keys FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

-- ----------------------------------------------------------------------------
-- 10. Model routing config — which model + provider for which use-case.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_model_routing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES public.agent_studio_agents(id) ON DELETE CASCADE,
  scope           text NOT NULL CHECK (scope IN ('ORG','TEAM','AGENT')),
  use_case        text NOT NULL,                          -- 'plan','code','review','spec','chat','tool_use'
  provider        text NOT NULL,
  model           text NOT NULL,
  provider_key_id uuid REFERENCES public.agent_studio_provider_keys(id) ON DELETE SET NULL,
  fallback        jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{provider,model,provider_key_id}]
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,    -- temperature, max_tokens, etc.
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_studio_model_routing_scope_chk CHECK (
    (scope = 'ORG'   AND team_id IS NULL  AND agent_id IS NULL) OR
    (scope = 'TEAM'  AND team_id IS NOT NULL AND agent_id IS NULL) OR
    (scope = 'AGENT' AND agent_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_model_routing_org ON public.agent_studio_model_routing(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_model_routing_team ON public.agent_studio_model_routing(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_model_routing_agent ON public.agent_studio_model_routing(agent_id);

CREATE TRIGGER trg_agent_studio_model_routing_updated_at
BEFORE UPDATE ON public.agent_studio_model_routing
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_model_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_model_routing_select_if_member"
ON public.agent_studio_model_routing FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_model_routing_write_if_admin"
ON public.agent_studio_model_routing FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

-- ----------------------------------------------------------------------------
-- 11. MCP server configuration.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_mcp_servers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  name            text NOT NULL,
  transport       text NOT NULL CHECK (transport IN ('stdio','sse','websocket','http')),
  command         text,                                 -- for stdio
  url             text,                                 -- for sse / websocket / http
  headers_ciphertext bytea,                             -- optional encrypted auth headers
  headers_iv      bytea,
  headers_tag     bytea,
  args            jsonb NOT NULL DEFAULT '[]'::jsonb,
  env             jsonb NOT NULL DEFAULT '{}'::jsonb,    -- non-secret env keys; secrets go to provider_keys
  enabled_tools   jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_mcp_servers_team ON public.agent_studio_mcp_servers(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_mcp_servers_org ON public.agent_studio_mcp_servers(org_id);

CREATE TRIGGER trg_agent_studio_mcp_servers_updated_at
BEFORE UPDATE ON public.agent_studio_mcp_servers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_mcp_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_mcp_servers_select_if_member"
ON public.agent_studio_mcp_servers FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_mcp_servers_write_if_admin"
ON public.agent_studio_mcp_servers FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

-- ----------------------------------------------------------------------------
-- 12. Integration config (Jira / Azure DevOps / GitHub / GitLab).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('jira','azure-devops','github','gitlab','linear','custom')),
  name            text NOT NULL,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,    -- non-secret config (base url, project key)
  credentials_ciphertext bytea,                          -- encrypted token / password / etc.
  credentials_iv  bytea,
  credentials_tag bytea,
  status          text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','READY','ERROR','DISABLED')),
  last_synced_at  timestamptz,
  last_error      text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_integrations_team ON public.agent_studio_integrations(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_studio_integrations_org ON public.agent_studio_integrations(org_id);

CREATE TRIGGER trg_agent_studio_integrations_updated_at
BEFORE UPDATE ON public.agent_studio_integrations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_integrations_select_if_member"
ON public.agent_studio_integrations FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_integrations_write_if_admin"
ON public.agent_studio_integrations FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
);

-- ----------------------------------------------------------------------------
-- 13. Dedicated audit log (separate from platform `audit_logs`).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES public.agent_studio_teams(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES public.agent_studio_agents(id) ON DELETE SET NULL,
  task_id         uuid REFERENCES public.agent_studio_tasks(id) ON DELETE SET NULL,
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind      text NOT NULL DEFAULT 'USER' CHECK (actor_kind IN ('USER','AGENT','SYSTEM')),
  event_type      text NOT NULL,                        -- e.g. 'team.create','agent.pause','task.move'
  resource_type   text,
  resource_id     uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_audit_org ON public.agent_studio_audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_studio_audit_team ON public.agent_studio_audit_logs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_studio_audit_event ON public.agent_studio_audit_logs(event_type);

ALTER TABLE public.agent_studio_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_audit_select_if_member"
ON public.agent_studio_audit_logs FOR SELECT
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- Inserts come from service role only (backend writes audits).
CREATE POLICY "agent_studio_audit_insert_service_only"
ON public.agent_studio_audit_logs FOR INSERT
WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- 14. Helper: ensure agent_studio_orgs row exists when org enables the product.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_studio_ensure_org_row(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agent_studio_orgs (org_id, enabled)
  VALUES (p_org_id, false)
  ON CONFLICT (org_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.agent_studio_ensure_org_row(uuid) TO authenticated, service_role;

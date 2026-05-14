-- Agent Studio — template packs, DB-backed role/persona templates, agent markdown files.
-- Generic platform model: optional workflow packs (BMAD is one pack, not the default).

-- ----------------------------------------------------------------------------
-- Template packs (workflow / agent bundles).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_template_packs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  key             text NOT NULL,
  name            text NOT NULL,
  description     text,
  category        text NOT NULL DEFAULT 'general',
  pack_type       text NOT NULL DEFAULT 'workflow' CHECK (pack_type IN (
    'agent', 'team', 'workflow', 'role', 'persona', 'tooling', 'review', 'custom'
  )),
  is_system       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_template_packs_system_key
  ON public.agent_studio_template_packs (key) WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_template_packs_org_key
  ON public.agent_studio_template_packs (org_id, key) WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_studio_template_packs_org
  ON public.agent_studio_template_packs(org_id) WHERE org_id IS NOT NULL;

CREATE TRIGGER trg_agent_studio_template_packs_updated_at
BEFORE UPDATE ON public.agent_studio_template_packs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_template_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_template_packs_select"
ON public.agent_studio_template_packs FOR SELECT
USING (
  (org_id IS NULL AND is_system AND is_active)
  OR (org_id IS NOT NULL AND public.is_org_member(org_id))
);

CREATE POLICY "agent_studio_template_packs_insert_staff"
ON public.agent_studio_template_packs FOR INSERT
WITH CHECK (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_template_packs_update_custom"
ON public.agent_studio_template_packs FOR UPDATE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_template_packs_delete_custom"
ON public.agent_studio_template_packs FOR DELETE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

-- ----------------------------------------------------------------------------
-- Role templates (org + optional pack; system rows use org_id NULL).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_role_templates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_pack_id        uuid REFERENCES public.agent_studio_template_packs(id) ON DELETE SET NULL,
  key                     text NOT NULL,
  name                    text NOT NULL,
  description             text,
  category                text NOT NULL DEFAULT 'custom',
  is_system               boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  default_capabilities    jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_tools           jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_model_use_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_review_gates    jsonb NOT NULL DEFAULT '[]'::jsonb,
  role_markdown           text NOT NULL DEFAULT '',
  default_agent_files     jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_role_templates_system_key
  ON public.agent_studio_role_templates (key) WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_role_templates_org_key
  ON public.agent_studio_role_templates (org_id, key) WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_studio_role_templates_pack
  ON public.agent_studio_role_templates(template_pack_id);

CREATE TRIGGER trg_agent_studio_role_templates_updated_at
BEFORE UPDATE ON public.agent_studio_role_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_role_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_role_templates_select"
ON public.agent_studio_role_templates FOR SELECT
USING (
  (org_id IS NULL AND is_system AND is_active)
  OR (org_id IS NOT NULL AND public.is_org_member(org_id))
);

CREATE POLICY "agent_studio_role_templates_insert_staff"
ON public.agent_studio_role_templates FOR INSERT
WITH CHECK (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_role_templates_update_custom"
ON public.agent_studio_role_templates FOR UPDATE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_role_templates_delete_custom"
ON public.agent_studio_role_templates FOR DELETE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

-- ----------------------------------------------------------------------------
-- Persona templates.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_persona_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_pack_id      uuid REFERENCES public.agent_studio_template_packs(id) ON DELETE SET NULL,
  key                   text NOT NULL,
  name                  text NOT NULL,
  description           text,
  category              text NOT NULL DEFAULT 'custom',
  is_system             boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  persona_markdown      text NOT NULL DEFAULT '',
  communication_style   text,
  decision_style        text,
  risk_style            text,
  collaboration_style   text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_persona_templates_system_key
  ON public.agent_studio_persona_templates (key) WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_persona_templates_org_key
  ON public.agent_studio_persona_templates (org_id, key) WHERE org_id IS NOT NULL;

CREATE TRIGGER trg_agent_studio_persona_templates_updated_at
BEFORE UPDATE ON public.agent_studio_persona_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_persona_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_persona_templates_select"
ON public.agent_studio_persona_templates FOR SELECT
USING (
  (org_id IS NULL AND is_system AND is_active)
  OR (org_id IS NOT NULL AND public.is_org_member(org_id))
);

CREATE POLICY "agent_studio_persona_templates_insert_staff"
ON public.agent_studio_persona_templates FOR INSERT
WITH CHECK (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_persona_templates_update_custom"
ON public.agent_studio_persona_templates FOR UPDATE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_persona_templates_delete_custom"
ON public.agent_studio_persona_templates FOR DELETE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

-- ----------------------------------------------------------------------------
-- Reusable markdown assets (system or org).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_template_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_pack_id uuid REFERENCES public.agent_studio_template_packs(id) ON DELETE SET NULL,
  key             text NOT NULL,
  name            text NOT NULL,
  description     text,
  asset_type      text NOT NULL CHECK (asset_type IN (
    'agent_md', 'persona_md', 'instructions_md', 'rules_md', 'tools_md', 'memory_md',
    'context_md', 'workflow_md', 'review_gates_md', 'handoff_md', 'heartbeat_md',
    'output_format_md', 'checklist_md', 'document_template_md', 'policy_md', 'custom_md'
  )),
  category        text NOT NULL DEFAULT 'custom',
  file_path       text NOT NULL,
  markdown        text NOT NULL DEFAULT '',
  is_system       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_template_assets_system_key
  ON public.agent_studio_template_assets (key) WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_studio_template_assets_org_key
  ON public.agent_studio_template_assets (org_id, key) WHERE org_id IS NOT NULL;

CREATE TRIGGER trg_agent_studio_template_assets_updated_at
BEFORE UPDATE ON public.agent_studio_template_assets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_template_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_template_assets_select"
ON public.agent_studio_template_assets FOR SELECT
USING (
  (org_id IS NULL AND is_system AND is_active)
  OR (org_id IS NOT NULL AND public.is_org_member(org_id))
);

CREATE POLICY "agent_studio_template_assets_insert_staff"
ON public.agent_studio_template_assets FOR INSERT
WITH CHECK (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_template_assets_update_custom"
ON public.agent_studio_template_assets FOR UPDATE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

CREATE POLICY "agent_studio_template_assets_delete_custom"
ON public.agent_studio_template_assets FOR DELETE
USING (
  org_id IS NOT NULL
  AND public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER')
  AND is_system = false
);

-- ----------------------------------------------------------------------------
-- Per-agent markdown files.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_agent_files (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id             uuid NOT NULL REFERENCES public.agent_studio_teams(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.agent_studio_agents(id) ON DELETE CASCADE,
  file_key            text NOT NULL,
  file_name           text NOT NULL,
  file_path           text NOT NULL,
  file_type           text NOT NULL CHECK (file_type IN (
    'agent', 'persona', 'instructions', 'rules', 'tools', 'memory', 'context', 'workflow',
    'review_gates', 'handoff', 'heartbeat', 'output_format', 'coding_standards', 'security_policy',
    'qa_checklist', 'definition_of_done', 'definition_of_ready', 'escalation_policy', 'mcp_policy',
    'model_routing', 'team_contract', 'project_context', 'custom'
  )),
  markdown            text NOT NULL DEFAULT '',
  is_required         boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_modified_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_agent_files_agent
  ON public.agent_studio_agent_files(agent_id);

CREATE TRIGGER trg_agent_studio_agent_files_updated_at
BEFORE UPDATE ON public.agent_studio_agent_files
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_studio_agent_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_agent_files_select_if_member"
ON public.agent_studio_agent_files FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_agent_files_write_if_analyst"
ON public.agent_studio_agent_files FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ----------------------------------------------------------------------------
-- File version history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_studio_agent_file_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_file_id   uuid NOT NULL REFERENCES public.agent_studio_agent_files(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  markdown        text NOT NULL,
  change_note     text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_studio_agent_file_versions_file
  ON public.agent_studio_agent_file_versions(agent_file_id, version DESC);

ALTER TABLE public.agent_studio_agent_file_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_studio_agent_file_versions_select_if_member"
ON public.agent_studio_agent_file_versions FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "agent_studio_agent_file_versions_write_if_analyst"
ON public.agent_studio_agent_file_versions FOR ALL
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
)
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST')
);

-- ----------------------------------------------------------------------------
-- Agents: link to DB templates + file mode.
-- ----------------------------------------------------------------------------
ALTER TABLE public.agent_studio_agents
  ADD COLUMN IF NOT EXISTS role_template_id uuid REFERENCES public.agent_studio_role_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS persona_template_id uuid REFERENCES public.agent_studio_persona_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_pack_id uuid REFERENCES public.agent_studio_template_packs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_file_mode text NOT NULL DEFAULT 'managed'
    CHECK (agent_file_mode IN ('managed', 'advanced', 'custom'));

COMMENT ON COLUMN public.agent_studio_teams.workflow_template_key IS 'Workflow template key from agent-core JSON (e.g. generic_software_delivery, bmad_full_sdlc).';

-- ----------------------------------------------------------------------------
-- Seed system workflow / agent packs (org_id NULL).
-- ----------------------------------------------------------------------------
INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'generic_agent_setup', 'Generic Agent Setup',
   'Default minimal setup for any agent team — roles, personas, and markdown files are generic.',
   'general', 'agent', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'generic_agent_setup');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'generic_software_delivery', 'Generic Software Delivery',
   'General-purpose software delivery workflow: planning, implementation, review, QA, and delivery.',
   'software', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'generic_software_delivery');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'bmad', 'BMAD Workflow Pack',
   'Optional BMAD-inspired software delivery workflow pack.',
   'software', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'bmad');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'scrum', 'Scrum Team', 'Sprint-based delivery workflow pack.', 'software', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'scrum');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'research', 'Research Team', 'Discovery and analysis workflow pack.', 'research', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'research');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'qa_review', 'QA Review Team', 'Quality-gate focused workflow pack.', 'qa', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'qa_review');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'security_review', 'Security Review Team', 'Security review–centric workflow pack.', 'security', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'security_review');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'data_analysis', 'Data Analysis Team', 'Data analysis and reporting workflow pack.', 'data', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'data_analysis');

INSERT INTO public.agent_studio_template_packs (org_id, key, name, description, category, pack_type, is_system, is_active)
SELECT NULL, 'customer_support', 'Customer Support', 'Support and triage workflow pack.', 'support', 'workflow', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.agent_studio_template_packs p WHERE p.org_id IS NULL AND p.key = 'customer_support');

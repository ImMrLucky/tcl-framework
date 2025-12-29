-- RBAC: Update RLS policies to use new permission system
-- FIXED: Handles tables without direct org_id (webhook_tokens)

-- Drop old policies that use role checks
DROP POLICY IF EXISTS "sources_insert_member" ON public.sources;
DROP POLICY IF EXISTS "sources_update_member" ON public.sources;
DROP POLICY IF EXISTS "validations_insert_member" ON public.validations;
DROP POLICY IF EXISTS "conversations_insert_member" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_member" ON public.conversations;
DROP POLICY IF EXISTS "evaluations_insert_member" ON public.evaluations;
DROP POLICY IF EXISTS "evaluations_update_member" ON public.evaluations;
DROP POLICY IF EXISTS "projects_insert_member" ON public.projects;
DROP POLICY IF EXISTS "api_keys_insert_admin" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_update_admin" ON public.api_keys;
DROP POLICY IF EXISTS "org_members_insert_admin" ON public.org_members;
DROP POLICY IF EXISTS "org_members_update_admin" ON public.org_members;

-- ============================================
-- SOURCES (Evidence Documents)
-- ============================================
-- View: All members can view
-- Insert/Update: Owner, Admin, QA Reviewer, Compliance, Engineer (anyone who can configure or review)
-- Delete: Owner, Admin only

CREATE POLICY "sources_insert_permission"
ON public.sources FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer', 'compliance', 'engineer')
);

CREATE POLICY "sources_update_permission"
ON public.sources FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer', 'compliance', 'engineer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer', 'compliance', 'engineer')
);

-- Delete policy already exists and is correct (owner/admin only)

-- ============================================
-- VALIDATIONS (Legacy - now Evaluations)
-- ============================================
-- View: All members can view
-- Insert: Owner, Admin, QA Reviewer (can review)
-- Update: Owner, Admin, QA Reviewer (can review)

CREATE POLICY "validations_insert_permission"
ON public.validations FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer')
);

CREATE POLICY "validations_update_permission"
ON public.validations FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer')
);

-- ============================================
-- CONVERSATIONS
-- ============================================
-- View: All members can view
-- Insert: Owner, Admin, Engineer (can configure integrations)
-- Update: Owner, Admin, Engineer (can configure integrations)
-- Delete: Owner, Admin only

CREATE POLICY "conversations_insert_permission"
ON public.conversations FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

CREATE POLICY "conversations_update_permission"
ON public.conversations FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

-- Delete policy already exists and is correct (owner/admin only)

-- ============================================
-- EVALUATIONS
-- ============================================
-- View: All members can view
-- Insert: Owner, Admin, QA Reviewer (can review)
-- Update: Owner, Admin, QA Reviewer (can review)
-- Delete: Owner, Admin only

CREATE POLICY "evaluations_insert_permission"
ON public.evaluations FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer')
);

CREATE POLICY "evaluations_update_permission"
ON public.evaluations FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'qa_reviewer')
);

-- Delete policy already exists and is correct (owner/admin only)

-- ============================================
-- PROJECTS
-- ============================================
-- View: All members can view
-- Insert: Owner, Admin (can configure)
-- Update: Owner, Admin (can configure)
-- Delete: Owner only

CREATE POLICY "projects_insert_permission"
ON public.projects FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin')
);

CREATE POLICY "projects_update_permission"
ON public.projects FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin')
);

-- Delete policy already exists and is correct (owner only)

-- ============================================
-- API KEYS
-- ============================================
-- View: Owner, Admin, Engineer (can manage integrations)
-- Insert: Owner, Admin, Engineer (can manage integrations)
-- Update: Owner, Admin, Engineer (can manage integrations)
-- Delete: Owner only

DROP POLICY IF EXISTS "api_keys_select_admin" ON public.api_keys;

CREATE POLICY "api_keys_select_permission"
ON public.api_keys FOR SELECT
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

CREATE POLICY "api_keys_insert_permission"
ON public.api_keys FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

CREATE POLICY "api_keys_update_permission"
ON public.api_keys FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

-- Delete policy already exists and is correct (owner only)

-- ============================================
-- ORG_MEMBERS
-- ============================================
-- View: All members can view
-- Insert: Owner, Admin (can manage members)
-- Update: Owner, Admin (can manage members)
-- Delete: Owner only

CREATE POLICY "org_members_insert_permission"
ON public.org_members FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin')
);

CREATE POLICY "org_members_update_permission"
ON public.org_members FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin')
);

-- Delete policy already exists and is correct (owner only)

-- ============================================
-- INTEGRATIONS (from 006_integrations_rls.sql)
-- ============================================
-- Update integration policies to use new roles

-- Drop old integration policies
DROP POLICY IF EXISTS "integrations_insert_member" ON public.integrations;
DROP POLICY IF EXISTS "integrations_update_member" ON public.integrations;
DROP POLICY IF EXISTS "webhook_tokens_insert_member" ON public.webhook_tokens;
DROP POLICY IF EXISTS "webhook_tokens_update_member" ON public.webhook_tokens;
DROP POLICY IF EXISTS "realtime_sessions_insert_member" ON public.realtime_sessions;
DROP POLICY IF EXISTS "realtime_sessions_update_member" ON public.realtime_sessions;
DROP POLICY IF EXISTS "delivery_attempts_insert_member" ON public.delivery_attempts;
DROP POLICY IF EXISTS "delivery_attempts_update_member" ON public.delivery_attempts;

-- Also drop the old policies from 006_integrations_rls.sql if they exist
DROP POLICY IF EXISTS "Users can view integrations in their org" ON public.integrations;
DROP POLICY IF EXISTS "Users can manage integrations in their org" ON public.integrations;
DROP POLICY IF EXISTS "Users can view webhook tokens in their org" ON public.webhook_tokens;
DROP POLICY IF EXISTS "Users can manage webhook tokens in their org" ON public.webhook_tokens;
DROP POLICY IF EXISTS "Users can view realtime sessions in their org" ON public.realtime_sessions;
DROP POLICY IF EXISTS "Users can manage realtime sessions in their org" ON public.realtime_sessions;
DROP POLICY IF EXISTS "Users can view delivery attempts in their org" ON public.delivery_attempts;
DROP POLICY IF EXISTS "Users can manage delivery attempts in their org" ON public.delivery_attempts;

-- Integrations: Owner, Admin, Engineer can manage
CREATE POLICY "integrations_insert_permission"
ON public.integrations FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

CREATE POLICY "integrations_update_permission"
ON public.integrations FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

-- Webhook tokens: Owner, Admin, Engineer can manage
-- NOTE: webhook_tokens doesn't have org_id directly, get it from integrations
CREATE POLICY "webhook_tokens_select_permission"
ON public.webhook_tokens FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.id = webhook_tokens.integration_id
      AND public.org_role(i.org_id) IN ('owner', 'admin', 'engineer')
  )
);

CREATE POLICY "webhook_tokens_insert_permission"
ON public.webhook_tokens FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.id = webhook_tokens.integration_id
      AND public.org_role(i.org_id) IN ('owner', 'admin', 'engineer')
  )
);

CREATE POLICY "webhook_tokens_update_permission"
ON public.webhook_tokens FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.id = webhook_tokens.integration_id
      AND public.org_role(i.org_id) IN ('owner', 'admin', 'engineer')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.id = webhook_tokens.integration_id
      AND public.org_role(i.org_id) IN ('owner', 'admin', 'engineer')
  )
);

-- Realtime sessions: Owner, Admin, Engineer can manage
CREATE POLICY "realtime_sessions_insert_permission"
ON public.realtime_sessions FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

CREATE POLICY "realtime_sessions_update_permission"
ON public.realtime_sessions FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

-- Delivery attempts: Owner, Admin, Engineer can manage
CREATE POLICY "delivery_attempts_insert_permission"
ON public.delivery_attempts FOR INSERT
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);

CREATE POLICY "delivery_attempts_update_permission"
ON public.delivery_attempts FOR UPDATE
USING (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
)
WITH CHECK (
  public.org_role(org_id) IN ('owner', 'admin', 'engineer')
);


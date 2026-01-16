-- Integrations Framework (Phase 5)
-- Enables enterprise integrations (Jira, Webhooks, etc.)

-- ============================================================================
-- 1. INTEGRATIONS TABLE (Enterprise Integrations - Phase 5)
-- Note: This is separate from the existing integrations table (005_integrations_schema.sql)
-- which is used for ingest integrations. This table is for enterprise export integrations.
-- ============================================================================

-- Check if table exists with old schema and handle migration
DO $$
BEGIN
  -- Check if integrations table exists and has the old schema (integration_type column)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'integrations' 
    AND column_name = 'integration_type'
  ) THEN
    -- Table exists with old schema - create new table with different name or migrate
    -- For now, we'll create a new table to avoid conflicts
    -- If you want to merge them, you'd need to migrate the data
    RAISE NOTICE 'Existing integrations table found with old schema. Creating enterprise_integrations table instead.';
  END IF;
END $$;

-- Create enterprise integrations table (separate from existing integrations table)
CREATE TABLE IF NOT EXISTS public.enterprise_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Integration type
  kind text NOT NULL CHECK (kind IN (
    'JIRA',
    'WEBHOOK',
    'ZENDESK',
    'SERVICENOW'
  )),
  
  -- Integration status
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')) DEFAULT 'ACTIVE',
  
  -- Non-secret configuration (stored as JSONB)
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Audit fields
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_integrations_org_id ON public.enterprise_integrations(org_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_integrations_kind ON public.enterprise_integrations(kind);
CREATE INDEX IF NOT EXISTS idx_enterprise_integrations_status ON public.enterprise_integrations(status);

CREATE TRIGGER trg_enterprise_integrations_updated_at
BEFORE UPDATE ON public.enterprise_integrations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. INTEGRATION SECRETS TABLE (Encrypted at rest)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.enterprise_integrations(id) ON DELETE CASCADE,
  integration_kind text NOT NULL CHECK (integration_kind IN (
    'JIRA',
    'WEBHOOK',
    'ZENDESK',
    'SERVICENOW'
  )),
  
  -- Secret key name (e.g., 'jira_api_token', 'webhook_signing_secret')
  key text NOT NULL,
  
  -- Encrypted secret value (should be encrypted using pgcrypto or similar)
  -- For now, store as text but should be encrypted in production
  ciphertext text NOT NULL,
  
  -- Audit fields
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Unique: one secret per key per integration
  UNIQUE(org_id, integration_kind, key)
);

CREATE INDEX IF NOT EXISTS idx_integration_secrets_org_id ON public.integration_secrets(org_id);
CREATE INDEX IF NOT EXISTS idx_integration_secrets_integration_id ON public.integration_secrets(integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_secrets_kind ON public.integration_secrets(integration_kind);

CREATE TRIGGER trg_integration_secrets_updated_at
BEFORE UPDATE ON public.integration_secrets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. INTEGRATION EXPORTS TABLE (Audit trail for all outbound exports)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.integration_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.enterprise_integrations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Export target
  target_type text NOT NULL CHECK (target_type IN (
    'ISSUE',
    'CASE',
    'AUDIT_PACK'
  )),
  target_id text NOT NULL, -- issue_id, case_id, or audit_pack_id
  
  -- Export status
  status text NOT NULL CHECK (status IN (
    'PENDING',
    'SENT',
    'FAILED'
  )) DEFAULT 'PENDING',
  
  -- External reference (e.g., Jira ticket key, webhook delivery ID)
  external_ref text,
  
  -- Error information (if failed)
  error text,
  
  -- Payload hash (for audit trail)
  payload_hash text,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_integration_exports_integration_id ON public.integration_exports(integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_exports_org_id ON public.integration_exports(org_id);
CREATE INDEX IF NOT EXISTS idx_integration_exports_target ON public.integration_exports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_integration_exports_status ON public.integration_exports(status);
CREATE INDEX IF NOT EXISTS idx_integration_exports_external_ref ON public.integration_exports(external_ref);
CREATE INDEX IF NOT EXISTS idx_integration_exports_created_at ON public.integration_exports(created_at DESC);

CREATE TRIGGER trg_integration_exports_updated_at
BEFORE UPDATE ON public.integration_exports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. WEBHOOK DELIVERIES TABLE (Detailed delivery tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.enterprise_integrations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  export_id uuid REFERENCES public.integration_exports(id) ON DELETE SET NULL,
  
  -- Delivery details
  event_type text NOT NULL,
  endpoint_url text NOT NULL,
  payload_json jsonb NOT NULL,
  
  -- Delivery status
  status text NOT NULL CHECK (status IN (
    'PENDING',
    'SENT',
    'FAILED',
    'RETRYING'
  )) DEFAULT 'PENDING',
  
  -- Response information
  response_status_code int,
  response_body text,
  error_message text,
  
  -- Retry information
  attempt_number int NOT NULL DEFAULT 1,
  max_attempts int NOT NULL DEFAULT 3,
  next_retry_at timestamptz,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_integration_id ON public.webhook_deliveries(integration_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id ON public.webhook_deliveries(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_export_id ON public.webhook_deliveries(export_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON public.webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON public.webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- ============================================================================
-- 5. RLS POLICIES
-- ============================================================================

ALTER TABLE public.enterprise_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Enterprise Integrations: org members can view, ADMIN+ can manage
CREATE POLICY "enterprise_integrations_select_if_member"
ON public.enterprise_integrations FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "enterprise_integrations_insert_if_admin"
ON public.enterprise_integrations FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

CREATE POLICY "enterprise_integrations_update_if_admin"
ON public.enterprise_integrations FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

CREATE POLICY "enterprise_integrations_delete_if_admin"
ON public.enterprise_integrations FOR DELETE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

-- Integration secrets: ADMIN+ can manage (never returned to UI after save)
CREATE POLICY "integration_secrets_select_if_admin"
ON public.integration_secrets FOR SELECT
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

CREATE POLICY "integration_secrets_insert_if_admin"
ON public.integration_secrets FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

CREATE POLICY "integration_secrets_update_if_admin"
ON public.integration_secrets FOR UPDATE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

CREATE POLICY "integration_secrets_delete_if_admin"
ON public.integration_secrets FOR DELETE
USING (
  public.is_org_member(org_id)
  AND public.org_role(org_id) IN ('OWNER', 'ADMIN')
);

-- Integration exports: org members can view
CREATE POLICY "integration_exports_select_if_member"
ON public.integration_exports FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "integration_exports_insert_if_member"
ON public.integration_exports FOR INSERT
WITH CHECK (public.is_org_member(org_id));

-- Webhook deliveries: org members can view
CREATE POLICY "webhook_deliveries_select_if_member"
ON public.webhook_deliveries FOR SELECT
USING (public.is_org_member(org_id));

CREATE POLICY "webhook_deliveries_insert_if_member"
ON public.webhook_deliveries FOR INSERT
WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "webhook_deliveries_update_if_member"
ON public.webhook_deliveries FOR UPDATE
USING (public.is_org_member(org_id));


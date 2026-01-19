-- Secure Bulk Ingestion Connectors
-- Adds support for DROPBOX, GDRIVE, S3 in integration_secrets
-- Creates oauth_states table for OAuth flow management

-- ============================================================================
-- 1. UPDATE integration_secrets CHECK CONSTRAINT
-- ============================================================================

-- Drop the old constraint
ALTER TABLE public.integration_secrets
DROP CONSTRAINT IF EXISTS integration_secrets_integration_kind_check;

-- Add new constraint with connector types
ALTER TABLE public.integration_secrets
ADD CONSTRAINT integration_secrets_integration_kind_check
CHECK (integration_kind IN (
  'JIRA',
  'WEBHOOK',
  'ZENDESK',
  'SERVICENOW',
  'DROPBOX',
  'GDRIVE',
  'S3'
));

-- ============================================================================
-- 2. OAUTH STATES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Provider (DROPBOX, GDRIVE, etc.)
  provider text NOT NULL CHECK (provider IN ('DROPBOX', 'GDRIVE')),
  
  -- OAuth state token (random string for CSRF protection)
  state_token text NOT NULL UNIQUE,
  
  -- Expires at (TTL for state tokens, typically 10 minutes)
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  
  -- Optional redirect URL after OAuth completes
  redirect_url text,
  
  -- Audit fields
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state_token ON public.oauth_states(state_token);
CREATE INDEX IF NOT EXISTS idx_oauth_states_org_user ON public.oauth_states(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON public.oauth_states(expires_at);

-- Cleanup expired states (can be run periodically)
-- DELETE FROM public.oauth_states WHERE expires_at < now();

-- ============================================================================
-- 3. ROW LEVEL SECURITY FOR oauth_states
-- ============================================================================

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

-- Users can only see their own OAuth states
CREATE POLICY "oauth_states_select_if_owner"
ON public.oauth_states FOR SELECT
USING (
  public.is_org_member(org_id)
  AND user_id = auth.uid()
);

-- Users can create OAuth states for their org
CREATE POLICY "oauth_states_insert_if_member"
ON public.oauth_states FOR INSERT
WITH CHECK (
  public.is_org_member(org_id)
  AND user_id = auth.uid()
);

-- Users can delete their own OAuth states
CREATE POLICY "oauth_states_delete_if_owner"
ON public.oauth_states FOR DELETE
USING (
  public.is_org_member(org_id)
  AND user_id = auth.uid()
);


-- Agent Studio entitlement key in org_entitlements + init_org_entitlements.
-- Ensures RPC / init paths know about `agentStudio` (defaults false; never
-- auto-enabled by TCL tier — see docs/specs/agent-studio.md).

-- 1. Backfill existing org rows that predate the key.
UPDATE public.org_entitlements
SET features = features || '{"agentStudio": false}'::jsonb
WHERE NOT (features ? 'agentStudio');

-- 2. Keep init_org_entitlements in sync (new orgs + tier re-init).
CREATE OR REPLACE FUNCTION public.init_org_entitlements(
  p_org_id uuid,
  p_tier text default 'SANDBOX'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_features jsonb;
BEGIN
  CASE p_tier
    WHEN 'SANDBOX' THEN
      v_features := jsonb_build_object(
        'enterpriseGovernance', false,
        'approvalsWorkflow', false,
        'auditPacksAdvanced', false,
        'legalHold', false,
        'issueDecisions', false,
        'reviewerSignoff', false,
        'cases', false,
        'integrations', false,
        'batchIngestion', false,
        'connectorsS3', false,
        'connectorsDropbox', false,
        'connectorsGDrive', false,
        'ssoSaml', false,
        'scim', false,
        'agentStudio', false
      );

    WHEN 'TEAM' THEN
      v_features := jsonb_build_object(
        'enterpriseGovernance', false,
        'approvalsWorkflow', false,
        'auditPacksAdvanced', false,
        'legalHold', false,
        'issueDecisions', true,
        'reviewerSignoff', false,
        'cases', false,
        'integrations', false,
        'batchIngestion', true,
        'connectorsS3', false,
        'connectorsDropbox', false,
        'connectorsGDrive', false,
        'ssoSaml', false,
        'scim', false,
        'agentStudio', false
      );

    WHEN 'ENTERPRISE' THEN
      v_features := jsonb_build_object(
        'enterpriseGovernance', true,
        'approvalsWorkflow', true,
        'auditPacksAdvanced', true,
        'legalHold', true,
        'issueDecisions', true,
        'reviewerSignoff', true,
        'cases', true,
        'integrations', true,
        'batchIngestion', true,
        'connectorsS3', true,
        'connectorsDropbox', true,
        'connectorsGDrive', true,
        'ssoSaml', false,
        'scim', false,
        'agentStudio', false
      );

    ELSE
      v_features := jsonb_build_object(
        'enterpriseGovernance', false,
        'approvalsWorkflow', false,
        'auditPacksAdvanced', false,
        'legalHold', false,
        'issueDecisions', false,
        'reviewerSignoff', false,
        'cases', false,
        'integrations', false,
        'batchIngestion', false,
        'connectorsS3', false,
        'connectorsDropbox', false,
        'connectorsGDrive', false,
        'ssoSaml', false,
        'scim', false,
        'agentStudio', false
      );
  END CASE;

  INSERT INTO public.org_entitlements (org_id, tier, features)
  VALUES (p_org_id, p_tier, v_features)
  ON CONFLICT (org_id) DO UPDATE
  SET tier = excluded.tier,
      features = excluded.features,
      updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.init_org_entitlements(uuid, text) TO authenticated;

-- ============================================================================
-- Enforce LOCKED Evidence Rules
-- ============================================================================
-- Updates resolve_evidence_set() to always include LOCKED org evidence
-- regardless of includeOrg flag (unless admin Simulation Mode)
-- ============================================================================

-- Drop and recreate resolve_evidence_set with LOCKED enforcement
-- Drop all overloads of the function to avoid ambiguity
DO $$
DECLARE
  func_record record;
BEGIN
  FOR func_record IN 
    SELECT oid::regprocedure as func_sig
    FROM pg_proc
    WHERE proname = 'resolve_evidence_set'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_sig || ' CASCADE';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_evidence_set(
  p_org_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_template_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_simulation_mode boolean DEFAULT false,
  p_include_org boolean DEFAULT true,
  p_include_project boolean DEFAULT true,
  p_include_template boolean DEFAULT true,
  p_current_time timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result jsonb := jsonb_build_object(
    'orgEvidenceIds', array[]::text[],
    'projectEvidenceIds', array[]::text[],
    'templateEvidenceIds', array[]::text[],
    'conversationEvidenceIds', array[]::text[],
    'resolvedEvidenceIds', array[]::text[]
  );
  v_status_filter text;
  v_now timestamptz;
BEGIN
  v_now := COALESCE(p_current_time, now());
  v_status_filter := CASE WHEN p_simulation_mode THEN 'DRAFT' ELSE 'APPROVED' END;

  -- ============================================================================
  -- ORG-LEVEL EVIDENCE
  -- ============================================================================
  -- Always include LOCKED org evidence, even if includeOrg is false
  -- (unless simulation mode, where locked rules don't apply)
  IF p_include_org OR NOT p_simulation_mode THEN
    SELECT array_agg(id::text ORDER BY created_at DESC)
    INTO v_result->'orgEvidenceIds'
    FROM public.evidence_items
    WHERE org_id = p_org_id
      AND scope = 'ORG'
      AND (
        -- Include if:
        -- 1. includeOrg is true AND status matches filter
        -- 2. OR override_policy is LOCKED (always include locked rules)
        (p_include_org AND status = v_status_filter)
        OR (override_policy = 'LOCKED' AND status = 'APPROVED')
      )
      AND (effective_from IS NULL OR effective_from <= v_now)
      AND (effective_to IS NULL OR effective_to >= v_now)
      AND index_status = 'INDEXED';
  END IF;

  -- ============================================================================
  -- PROJECT-LEVEL EVIDENCE
  -- ============================================================================
  IF p_include_project AND p_project_id IS NOT NULL THEN
    SELECT array_agg(id::text ORDER BY created_at DESC)
    INTO v_result->'projectEvidenceIds'
    FROM public.evidence_items
    WHERE org_id = p_org_id
      AND project_id = p_project_id
      AND scope = 'PROJECT'
      AND status = v_status_filter
      AND (effective_from IS NULL OR effective_from <= v_now)
      AND (effective_to IS NULL OR effective_to >= v_now)
      AND index_status = 'INDEXED';
  END IF;

  -- ============================================================================
  -- TEMPLATE-LEVEL EVIDENCE
  -- ============================================================================
  IF p_include_template AND p_template_id IS NOT NULL THEN
    SELECT array_agg(id::text ORDER BY created_at DESC)
    INTO v_result->'templateEvidenceIds'
    FROM public.evidence_items
    WHERE org_id = p_org_id
      AND template_id = p_template_id
      AND scope = 'TEMPLATE'
      AND status = v_status_filter
      AND (effective_from IS NULL OR effective_from <= v_now)
      AND (effective_to IS NULL OR effective_to >= v_now)
      AND index_status = 'INDEXED';
  END IF;

  -- ============================================================================
  -- CONVERSATION-LEVEL EVIDENCE
  -- ============================================================================
  -- Always include conversation evidence (user-uploaded)
  IF p_conversation_id IS NOT NULL THEN
    SELECT array_agg(id::text ORDER BY created_at DESC)
    INTO v_result->'conversationEvidenceIds'
    FROM public.evidence_items
    WHERE org_id = p_org_id
      AND conversation_id = p_conversation_id
      AND scope = 'CONVERSATION'
      AND status = v_status_filter
      AND (effective_from IS NULL OR effective_from <= v_now)
      AND (effective_to IS NULL OR effective_to >= v_now)
      AND index_status = 'INDEXED';
  END IF;

  -- ============================================================================
  -- RESOLVED EVIDENCE IDs (union of all)
  -- ============================================================================
  SELECT array_agg(DISTINCT id::text)
  INTO v_result->'resolvedEvidenceIds'
  FROM public.evidence_items
  WHERE org_id = p_org_id
    AND (
      -- Org evidence (including LOCKED)
      (scope = 'ORG' AND (
        (p_include_org AND status = v_status_filter)
        OR (override_policy = 'LOCKED' AND status = 'APPROVED')
      ))
      -- Project evidence
      OR (p_include_project AND p_project_id IS NOT NULL 
          AND project_id = p_project_id AND scope = 'PROJECT' AND status = v_status_filter)
      -- Template evidence
      OR (p_include_template AND p_template_id IS NOT NULL 
          AND template_id = p_template_id AND scope = 'TEMPLATE' AND status = v_status_filter)
      -- Conversation evidence
      OR (p_conversation_id IS NOT NULL 
          AND conversation_id = p_conversation_id AND scope = 'CONVERSATION' AND status = v_status_filter)
    )
    AND (effective_from IS NULL OR effective_from <= v_now)
    AND (effective_to IS NULL OR effective_to >= v_now)
    AND index_status = 'INDEXED';

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_evidence_set IS 
'Resolves evidence set for an evaluation run. Always includes LOCKED org evidence regardless of includeOrg flag (unless simulation mode).';


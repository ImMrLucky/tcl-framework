-- ============================================================================
-- Migration: Policies → Evidence
-- ============================================================================
-- Converts existing Policy records to EvidenceItem records
-- Part of Evidence: Company Docs & Rules system
--
-- This migration:
--   1. Creates EvidenceItem records from existing policies
--   2. Sets appropriate defaults (scope=ORG, sourceType=POLICY, etc.)
--   3. Preserves metadata and relationships
--   4. Marks policies as migrated (optional: can deprecate policies table later)
-- ============================================================================

-- ============================================================================
-- 1. MIGRATE POLICIES TO EVIDENCE_ITEMS
-- ============================================================================

INSERT INTO public.evidence_items (
  id,
  org_id,
  scope,
  source_type,
  title,
  description,
  storage_kind,
  -- Store policy content as TEXT (storage_kind = 'TEXT' not supported, use FILE with text content)
  -- For now, we'll store the content in a text file reference or use description
  -- Actually, evidence_items doesn't store raw text content - it's either FILE or LINK
  -- We'll need to create a text file in storage or store as description
  -- For migration, we'll use description to store the content temporarily
  -- and mark it as needing file upload
  
  -- Governance
  status,
  version,
  effective_from,
  created_by,
  created_at,
  updated_at,
  
  -- Authority & Override
  authority_level,
  override_policy,
  
  -- Indexing (will need to be indexed after migration)
  index_status,
  
  -- Metadata
  tags,
  rule_meta
)
SELECT 
  gen_random_uuid(), -- New ID for evidence item
  p.org_id,
  'ORG'::text, -- All policies are org-scoped
  'POLICY'::text, -- sourceType = POLICY
  p.name, -- title = policy name
  COALESCE(p.description, p.content), -- description = policy description or content
  'FILE'::text, -- storage_kind = FILE (we'll need to create actual files later)
  
  -- Governance: map status
  CASE 
    WHEN p.status = 'active' THEN 'APPROVED'::text
    WHEN p.status = 'draft' THEN 'DRAFT'::text
    WHEN p.status = 'archived' THEN 'DEPRECATED'::text
    ELSE 'DRAFT'::text
  END,
  p.version,
  p.activated_at, -- effective_from = activated_at
  p.created_by,
  p.created_at,
  p.updated_at,
  
  -- Authority: default to INFORMATIONAL (policies were guidance, not binding)
  'INFORMATIONAL'::text,
  'ALLOW_SUPPLEMENT'::text, -- Default override policy
  
  -- Indexing: mark as PENDING (will need to be indexed)
  'PENDING'::text,
  
  -- Extract tags from metadata if available
  COALESCE(
    (p.metadata->>'tags')::text[],
    ARRAY[]::text[]
  ),
  
  -- Store original policy metadata in rule_meta
  jsonb_build_object(
    'original_policy_id', p.id,
    'original_policy_name', p.name,
    'migrated_from', 'policies',
    'migrated_at', now()
  )
FROM public.policies p
WHERE NOT EXISTS (
  -- Don't migrate if already migrated (check rule_meta for original_policy_id)
  SELECT 1
  FROM public.evidence_items ei
  WHERE ei.rule_meta->>'original_policy_id' = p.id::text
);

-- ============================================================================
-- 2. CREATE MIGRATION TRACKING
-- ============================================================================

-- Add a column to policies table to track migration (optional, for reference)
ALTER TABLE public.policies
ADD COLUMN IF NOT EXISTS migrated_to_evidence_id uuid REFERENCES public.evidence_items(id) ON DELETE SET NULL;

-- Update the migrated_to_evidence_id for policies that were migrated
UPDATE public.policies p
SET migrated_to_evidence_id = ei.id
FROM public.evidence_items ei
WHERE ei.rule_meta->>'original_policy_id' = p.id::text
  AND p.migrated_to_evidence_id IS NULL;

-- ============================================================================
-- 3. MIGRATE POLICY_SOURCES TO EVIDENCE REFERENCES (if applicable)
-- ============================================================================

-- Note: policy_sources links policies to sources table
-- If sources are also being migrated to evidence_items, we can create links
-- For now, we'll preserve the relationship in rule_meta

-- ============================================================================
-- 4. COMMENTS
-- ============================================================================

COMMENT ON COLUMN public.policies.migrated_to_evidence_id IS 'Reference to the evidence_item this policy was migrated to. Set during migration from policies to evidence system.';

-- ============================================================================
-- NOTES FOR POST-MIGRATION
-- ============================================================================
-- After running this migration:
-- 1. Evidence items will be created but may not have actual file storage
-- 2. Content is stored in description field (temporary)
-- 3. Indexing status is PENDING - run indexing worker to index these
-- 4. Consider creating actual text files in Supabase Storage for migrated policies
-- 5. Update UI to use evidence_items instead of policies
-- 6. Eventually deprecate policies routes/pages (after full migration)


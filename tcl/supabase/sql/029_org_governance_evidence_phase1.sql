-- ============================================================================
-- Org Governance & Evidence System Phase 1
-- ============================================================================
-- Implements org governance (roles, ownership, recovery) and evidence enhancements
-- Part of Evidence: Company Docs & Rules + Industry Templates + Org Governance
--
-- Phase 1 includes:
--   - Org membership roles (OWNER, ADMIN, MANAGER, ANALYST, VIEWER)
--   - Org ownership tracking and transfer
--   - Evidence authority levels and override policies
--   - Templates system
--   - Policies → Evidence migration support
-- ============================================================================

-- ============================================================================
-- 1. UPDATE ORG MEMBERSHIP ROLES
-- ============================================================================

-- Step 1: Drop the old constraint
ALTER TABLE public.org_members
DROP CONSTRAINT IF EXISTS org_members_role_check;

-- Step 2: Migrate existing roles to new system FIRST (before adding constraint)
-- owner -> OWNER
-- admin -> ADMIN
-- qa_reviewer, compliance, engineer -> MANAGER (they can create/manage but not approve)
-- viewer -> VIEWER
-- ANALYST role doesn't exist in old system, so no migration needed for it
UPDATE public.org_members
SET role = CASE
  WHEN role = 'owner' THEN 'OWNER'
  WHEN role = 'admin' THEN 'ADMIN'
  WHEN role IN ('qa_reviewer', 'compliance', 'engineer') THEN 'MANAGER'
  WHEN role = 'viewer' THEN 'VIEWER'
  WHEN role IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER') THEN role -- Already migrated
  ELSE 'VIEWER' -- fallback for any unexpected values
END;

-- Step 3: Now add the new constraint after data is migrated
ALTER TABLE public.org_members
ADD CONSTRAINT org_members_role_check 
CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'));

-- ============================================================================
-- 2. ADD ORG OWNERSHIP TRACKING
-- ============================================================================

-- Add owner_user_id to organizations table
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Set owner_user_id from first OWNER in org_members
UPDATE public.organizations o
SET owner_user_id = (
  SELECT user_id
  FROM public.org_members om
  WHERE om.org_id = o.id
    AND om.role = 'OWNER'
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE owner_user_id IS NULL;

-- Create index for owner lookups
CREATE INDEX IF NOT EXISTS idx_organizations_owner_user_id ON public.organizations(owner_user_id);

-- ============================================================================
-- 3. ADD EVIDENCE AUTHORITY LEVELS & OVERRIDE POLICIES
-- ============================================================================

-- Add authority_level to evidence_items
ALTER TABLE public.evidence_items
ADD COLUMN IF NOT EXISTS authority_level text NOT NULL DEFAULT 'INFORMATIONAL' 
  CHECK (authority_level IN ('BINDING', 'INFORMATIONAL'));

-- Add override_policy to evidence_items (ORG scope only)
ALTER TABLE public.evidence_items
ADD COLUMN IF NOT EXISTS override_policy text 
  CHECK (override_policy IN ('LOCKED', 'ALLOW_SUPPLEMENT', 'ALLOW_OVERRIDE'));

-- Set override_policy for ORG scope evidence
-- BINDING evidence defaults to LOCKED, INFORMATIONAL defaults to ALLOW_SUPPLEMENT
UPDATE public.evidence_items
SET override_policy = CASE
  WHEN scope = 'ORG' AND authority_level = 'BINDING' THEN 'LOCKED'
  WHEN scope = 'ORG' AND authority_level = 'INFORMATIONAL' THEN 'ALLOW_SUPPLEMENT'
  ELSE NULL -- Not applicable for non-ORG scope
END
WHERE override_policy IS NULL AND scope = 'ORG';

-- Create index for locked evidence lookups
CREATE INDEX IF NOT EXISTS idx_evidence_items_override_policy ON public.evidence_items(override_policy) 
  WHERE override_policy = 'LOCKED';

-- ============================================================================
-- 4. TEMPLATES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Template metadata
  name text NOT NULL,
  description text,
  industry text CHECK (industry IN ('FINANCE', 'TELECOM', 'HEALTHCARE', 'INSURANCE', 'SAAS', 'RETAIL', 'GOV', 'OTHER', 'UNKNOWN')),
  business_function text CHECK (business_function IN ('BILLING_SUPPORT', 'CUSTOMER_SUPPORT_RETENTION', 'SALES_ONBOARDING', 'REGULATED_OPERATIONS', 'MIXED')),
  
  -- Defaults
  default_lens text CHECK (default_lens IN ('regulatory_exposure', 'financial_exposure', 'customer_dispute_risk', 'promise_commitment_risk', 'privacy_security_risk', 'operational_process_risk', 'neutral_engine_order')),
  
  -- Guidance content
  guidance_markdown text, -- Markdown guidance on what docs to upload, suggested tags, etc.
  
  -- Attached evidence (references evidence_items)
  attached_evidence_ids uuid[] DEFAULT array[]::uuid[],
  
  -- Audit
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- If org_id is NULL, it's a system/seed template
  is_system_template boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_templates_org_id ON public.templates(org_id);
CREATE INDEX IF NOT EXISTS idx_templates_industry ON public.templates(industry);
CREATE INDEX IF NOT EXISTS idx_templates_business_function ON public.templates(business_function);
CREATE INDEX IF NOT EXISTS idx_templates_is_system_template ON public.templates(is_system_template);

CREATE TRIGGER trg_templates_updated_at
BEFORE UPDATE ON public.templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. ORG ADMIN RECOVERY REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.org_admin_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Request details
  reason text,
  user_email text, -- Email of requester (for support reference)
  user_name text,
  
  -- Resolution
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'RESOLVED')),
  resolved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- Support/admin who resolved
  resolution_notes text,
  resolved_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_admin_recovery_org_id ON public.org_admin_recovery_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_org_admin_recovery_status ON public.org_admin_recovery_requests(status);
CREATE INDEX IF NOT EXISTS idx_org_admin_recovery_created_at ON public.org_admin_recovery_requests(created_at DESC);

-- ============================================================================
-- 6. GUARDRAIL FUNCTIONS
-- ============================================================================

-- Function to check if org has at least one ADMIN
CREATE OR REPLACE FUNCTION public.org_has_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.org_members
    WHERE org_id = p_org_id
      AND role IN ('OWNER', 'ADMIN')
  );
$$;

-- Function to check if org has exactly one OWNER
CREATE OR REPLACE FUNCTION public.org_has_owner(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*) = 1
  FROM public.org_members
  WHERE org_id = p_org_id
    AND role = 'OWNER';
$$;

-- Function to get org owner user_id
CREATE OR REPLACE FUNCTION public.org_owner_user_id(p_org_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT user_id
  FROM public.org_members
  WHERE org_id = p_org_id
    AND role = 'OWNER'
  LIMIT 1;
$$;

-- ============================================================================
-- 7. UPDATE PERMISSION FUNCTIONS FOR NEW ROLES
-- ============================================================================

-- Update has_permission to use new roles
CREATE OR REPLACE FUNCTION public.has_permission(
  p_org_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Get user's role in org
  SELECT role INTO v_role
  FROM public.org_members
  WHERE org_id = p_org_id
    AND user_id = auth.uid()
  LIMIT 1;

  -- If no role, deny
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Permission matrix based on new roles
  CASE p_permission
    WHEN 'view' THEN
      -- All roles can view
      RETURN true;
    
    WHEN 'review' THEN
      -- OWNER, ADMIN, MANAGER can review
      RETURN v_role IN ('OWNER', 'ADMIN', 'MANAGER');
    
    WHEN 'configure' THEN
      -- OWNER, ADMIN can configure
      RETURN v_role IN ('OWNER', 'ADMIN');
    
    WHEN 'export' THEN
      -- OWNER, ADMIN, MANAGER can export
      RETURN v_role IN ('OWNER', 'ADMIN', 'MANAGER');
    
    WHEN 'billing' THEN
      -- Only OWNER can manage billing
      RETURN v_role = 'OWNER';
    
    WHEN 'manage_members' THEN
      -- OWNER and ADMIN can manage members
      RETURN v_role IN ('OWNER', 'ADMIN');
    
    WHEN 'manage_integrations' THEN
      -- OWNER, ADMIN can manage integrations
      RETURN v_role IN ('OWNER', 'ADMIN');
    
    WHEN 'approve_evidence' THEN
      -- OWNER, ADMIN can approve evidence
      RETURN v_role IN ('OWNER', 'ADMIN');
    
    WHEN 'lock_evidence' THEN
      -- OWNER, ADMIN can lock evidence
      RETURN v_role IN ('OWNER', 'ADMIN');
    
    WHEN 'create_evidence' THEN
      -- OWNER, ADMIN, MANAGER can create evidence
      RETURN v_role IN ('OWNER', 'ADMIN', 'MANAGER');
    
    WHEN 'simulation_mode' THEN
      -- OWNER, ADMIN can use simulation mode
      RETURN v_role IN ('OWNER', 'ADMIN');
    
    ELSE
      -- Unknown permission, deny by default
      RETURN false;
  END CASE;
END;
$$;

-- ============================================================================
-- 8. ENABLE RLS ON NEW TABLES
-- ============================================================================

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_admin_recovery_requests ENABLE ROW LEVEL SECURITY;

-- Templates: org members can view org templates, all can view system templates
CREATE POLICY "templates_select_org_member"
ON public.templates FOR SELECT
USING (
  is_system_template = true
  OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = templates.org_id
      AND user_id = auth.uid()
  )
);

-- Templates: OWNER/ADMIN can manage org templates
CREATE POLICY "templates_insert_admin"
ON public.templates FOR INSERT
WITH CHECK (
  org_id IS NULL -- System templates created by backend
  OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = templates.org_id
      AND user_id = auth.uid()
      AND role IN ('OWNER', 'ADMIN')
  )
);

CREATE POLICY "templates_update_admin"
ON public.templates FOR UPDATE
USING (
  org_id IS NULL -- System templates managed by backend
  OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = templates.org_id
      AND user_id = auth.uid()
      AND role IN ('OWNER', 'ADMIN')
  )
);

CREATE POLICY "templates_delete_admin"
ON public.templates FOR DELETE
USING (
  org_id IS NULL -- System templates managed by backend
  OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = templates.org_id
      AND user_id = auth.uid()
      AND role IN ('OWNER', 'ADMIN')
  )
);

-- Admin recovery requests: users can create their own, org members can view
CREATE POLICY "org_admin_recovery_select_member"
ON public.org_admin_recovery_requests FOR SELECT
USING (
  requested_by_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = org_admin_recovery_requests.org_id
      AND user_id = auth.uid()
  )
);

CREATE POLICY "org_admin_recovery_insert_self"
ON public.org_admin_recovery_requests FOR INSERT
WITH CHECK (requested_by_user_id = auth.uid());

-- ============================================================================
-- 9. SEED SYSTEM TEMPLATES (Scaffold only, no authoritative text)
-- ============================================================================

-- Finance Support Template
INSERT INTO public.templates (
  id,
  name,
  description,
  industry,
  business_function,
  default_lens,
  guidance_markdown,
  is_system_template,
  created_at
) VALUES (
  gen_random_uuid(),
  'Finance - Customer Support',
  'Template for finance industry customer support operations',
  'FINANCE',
  'CUSTOMER_SUPPORT_RETENTION',
  'regulatory_exposure',
  '# Finance Customer Support Template

## Recommended Evidence Documents

### Compliance & Regulatory
- PCI-DSS compliance documentation
- SOX controls documentation
- Financial services regulations (CFPB, SEC)

### Policies & Procedures
- Refund and chargeback policies
- Account verification procedures
- Data retention policies

### Knowledge Base
- Fee schedules
- Account terms and conditions
- Product documentation

## Suggested Tags
- pci
- sox
- refund
- chargeback
- verification
- fees

## Default Lens
**Regulatory Exposure** - Prioritizes compliance and regulatory issues.',
  true,
  now()
) ON CONFLICT DO NOTHING;

-- Finance Sales Template
INSERT INTO public.templates (
  id,
  name,
  description,
  industry,
  business_function,
  default_lens,
  guidance_markdown,
  is_system_template,
  created_at
) VALUES (
  gen_random_uuid(),
  'Finance - Sales & Onboarding',
  'Template for finance industry sales and onboarding',
  'FINANCE',
  'SALES_ONBOARDING',
  'regulatory_exposure',
  '# Finance Sales & Onboarding Template

## Recommended Evidence Documents

### Compliance & Regulatory
- KYC/AML procedures
- Investment advisor disclosures
- Suitability requirements

### Policies & Procedures
- Sales scripts and disclosures
- Account opening procedures
- Risk disclosures

## Suggested Tags
- kyc
- aml
- suitability
- disclosure
- onboarding

## Default Lens
**Regulatory Exposure** - Prioritizes compliance and regulatory issues.',
  true,
  now()
) ON CONFLICT DO NOTHING;

-- Telecom Billing Template
INSERT INTO public.templates (
  id,
  name,
  description,
  industry,
  business_function,
  default_lens,
  guidance_markdown,
  is_system_template,
  created_at
) VALUES (
  gen_random_uuid(),
  'Telecom - Billing Support',
  'Template for telecom industry billing support',
  'TELECOM',
  'BILLING_SUPPORT',
  'financial_exposure',
  '# Telecom Billing Support Template

## Recommended Evidence Documents

### Policies & Procedures
- Billing dispute procedures
- Service cancellation policies
- Fee disclosure documents

### Knowledge Base
- Rate plans and pricing
- Billing cycle documentation
- Payment terms

## Suggested Tags
- billing
- dispute
- cancellation
- fees
- payment

## Default Lens
**Financial Exposure** - Prioritizes billing and financial issues.',
  true,
  now()
) ON CONFLICT DO NOTHING;

-- Healthcare Support Template
INSERT INTO public.templates (
  id,
  name,
  description,
  industry,
  business_function,
  default_lens,
  guidance_markdown,
  is_system_template,
  created_at
) VALUES (
  gen_random_uuid(),
  'Healthcare - Customer Support',
  'Template for healthcare industry customer support',
  'HEALTHCARE',
  'CUSTOMER_SUPPORT_RETENTION',
  'privacy_security_risk',
  '# Healthcare Customer Support Template

## Recommended Evidence Documents

### Compliance & Regulatory
- HIPAA compliance documentation
- PHI handling procedures
- Patient privacy policies

### Policies & Procedures
- Patient data access procedures
- Consent management
- Breach notification procedures

## Suggested Tags
- hipaa
- phi
- privacy
- consent
- breach

## Default Lens
**Privacy/Security Risk** - Prioritizes privacy and security issues.',
  true,
  now()
) ON CONFLICT DO NOTHING;

-- Generic Support Template
INSERT INTO public.templates (
  id,
  name,
  description,
  industry,
  business_function,
  default_lens,
  guidance_markdown,
  is_system_template,
  created_at
) VALUES (
  gen_random_uuid(),
  'Generic - Customer Support',
  'Generic template for customer support operations',
  'OTHER',
  'CUSTOMER_SUPPORT_RETENTION',
  'neutral_engine_order',
  '# Generic Customer Support Template

## Recommended Evidence Documents

### Policies & Procedures
- Customer service standards
- Refund and return policies
- Escalation procedures

### Knowledge Base
- Product documentation
- FAQ documents
- Service level agreements

## Suggested Tags
- support
- refund
- escalation
- sla

## Default Lens
**Neutral (Risk Score)** - Standard risk-based ordering.',
  true,
  now()
) ON CONFLICT DO NOTHING;

-- Generic Sales Template
INSERT INTO public.templates (
  id,
  name,
  description,
  industry,
  business_function,
  default_lens,
  guidance_markdown,
  is_system_template,
  created_at
) VALUES (
  gen_random_uuid(),
  'Generic - Sales & Onboarding',
  'Generic template for sales and onboarding',
  'OTHER',
  'SALES_ONBOARDING',
  'promise_commitment_risk',
  '# Generic Sales & Onboarding Template

## Recommended Evidence Documents

### Policies & Procedures
- Sales scripts and disclosures
- Terms of service
- Pricing and fee disclosures

### Knowledge Base
- Product documentation
- Pricing guides
- Onboarding checklists

## Suggested Tags
- sales
- disclosure
- pricing
- onboarding
- terms

## Default Lens
**Promise/Commitment Risk** - Prioritizes commitment and promise issues.',
  true,
  now()
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- 10. UPDATE PROJECTS TABLE TO REFERENCE TEMPLATES
-- ============================================================================

-- Add foreign key constraint for default_template_id if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'projects_default_template_id_fkey'
  ) THEN
    ALTER TABLE public.projects
    ADD CONSTRAINT projects_default_template_id_fkey
    FOREIGN KEY (default_template_id) REFERENCES public.templates(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 11. UPDATE EVIDENCE_ITEMS TO REFERENCE TEMPLATES
-- ============================================================================

-- Add foreign key constraint for template_id if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'evidence_items_template_id_fkey'
  ) THEN
    ALTER TABLE public.evidence_items
    ADD CONSTRAINT evidence_items_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 12. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN public.organizations.owner_user_id IS 'The user_id of the org owner. Exactly one OWNER per org.';
COMMENT ON COLUMN public.evidence_items.authority_level IS 'BINDING: Must be followed. INFORMATIONAL: Guidance only.';
COMMENT ON COLUMN public.evidence_items.override_policy IS 'LOCKED: Always included, cannot be disabled. ALLOW_SUPPLEMENT: Can add more. ALLOW_OVERRIDE: Can disable (admin only).';
COMMENT ON COLUMN public.templates.is_system_template IS 'If true, this is a system/seed template available to all orgs. If false, org-specific.';


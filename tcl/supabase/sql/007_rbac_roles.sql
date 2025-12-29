-- RBAC: Update roles and add permission system
-- Supports: owner, admin, qa_reviewer, compliance, engineer, viewer

-- Step 1: Update org_members role constraint to support new roles
ALTER TABLE public.org_members
DROP CONSTRAINT IF EXISTS org_members_role_check;

ALTER TABLE public.org_members
ADD CONSTRAINT org_members_role_check 
CHECK (role IN ('owner', 'admin', 'qa_reviewer', 'compliance', 'engineer', 'viewer'));

-- Step 2: Migrate existing 'member' role to 'viewer' (most restrictive)
UPDATE public.org_members
SET role = 'viewer'
WHERE role = 'member';

-- Step 3: Create permission helper functions
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

  -- Permission matrix based on role
  CASE p_permission
    WHEN 'view' THEN
      -- All roles can view
      RETURN true;
    
    WHEN 'review' THEN
      -- Owner, Admin, QA Reviewer can review
      RETURN v_role IN ('owner', 'admin', 'qa_reviewer');
    
    WHEN 'configure' THEN
      -- Owner, Admin, Engineer can configure
      RETURN v_role IN ('owner', 'admin', 'engineer');
    
    WHEN 'export' THEN
      -- Owner, Admin, Compliance can export
      RETURN v_role IN ('owner', 'admin', 'compliance');
    
    WHEN 'billing' THEN
      -- Only Owner can manage billing
      RETURN v_role = 'owner';
    
    WHEN 'manage_members' THEN
      -- Owner and Admin can manage members
      RETURN v_role IN ('owner', 'admin');
    
    WHEN 'manage_integrations' THEN
      -- Owner, Admin, Engineer can manage integrations
      RETURN v_role IN ('owner', 'admin', 'engineer');
    
    ELSE
      -- Unknown permission, deny by default
      RETURN false;
  END CASE;
END;
$$;

-- Step 4: Create function to check if user can configure (general config)
CREATE OR REPLACE FUNCTION public.can_configure(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.has_permission(p_org_id, 'configure');
$$;

-- Step 5: Create function to check if user can review
CREATE OR REPLACE FUNCTION public.can_review(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.has_permission(p_org_id, 'review');
$$;

-- Step 6: Create function to check if user can export
CREATE OR REPLACE FUNCTION public.can_export(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.has_permission(p_org_id, 'export');
$$;

-- Step 7: Create function to check if user can manage billing
CREATE OR REPLACE FUNCTION public.can_manage_billing(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.has_permission(p_org_id, 'billing');
$$;

-- Step 8: Create function to check if user can manage integrations
CREATE OR REPLACE FUNCTION public.can_manage_integrations(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.has_permission(p_org_id, 'manage_integrations');
$$;

-- Step 9: Update org_role function to return the new role values
-- (Already exists, but ensure it works with new roles)
-- No changes needed - it already returns the role from org_members

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_configure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_export(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_billing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_integrations(uuid) TO authenticated;


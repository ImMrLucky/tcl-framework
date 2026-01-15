-- Seed Internal Test Orgs
-- Creates three internal test organizations for admin testing
-- Run this in dev/staging environments

-- Note: This script should be idempotent (safe to run multiple times)

do $$
declare
  v_sandbox_org_id uuid;
  v_team_org_id uuid;
  v_enterprise_org_id uuid;
  v_first_superuser_id uuid;
begin
  -- Get first superuser (or create a placeholder if none exists)
  select id into v_first_superuser_id
  from public.profiles
  where role = 'SUPERUSER'
  limit 1;

  -- If no superuser exists, we'll still create the orgs but skip membership
  -- (membership can be added manually later)

  -- 1. Create/Get ProtectQA Internal Sandbox
  insert into public.organizations (
    name,
    slug,
    plan_tier,
    plan_status,
    is_internal_test,
    billing_mode,
    created_at,
    updated_at
  )
  values (
    'ProtectQA Internal Sandbox',
    'protectqa-internal-sandbox',
    'SANDBOX',
    'ACTIVE',
    true,
    'COMPED',
    now(),
    now()
  )
  on conflict (slug) do update
  set
    plan_tier = 'SANDBOX',
    plan_status = 'ACTIVE',
    is_internal_test = true,
    billing_mode = 'COMPED',
    updated_at = now()
  returning id into v_sandbox_org_id;

  -- 2. Create/Get ProtectQA Internal Team
  insert into public.organizations (
    name,
    slug,
    plan_tier,
    plan_status,
    is_internal_test,
    billing_mode,
    created_at,
    updated_at
  )
  values (
    'ProtectQA Internal Team',
    'protectqa-internal-team',
    'TEAM',
    'ACTIVE',
    true,
    'COMPED',
    now(),
    now()
  )
  on conflict (slug) do update
  set
    plan_tier = 'TEAM',
    plan_status = 'ACTIVE',
    is_internal_test = true,
    billing_mode = 'COMPED',
    updated_at = now()
  returning id into v_team_org_id;

  -- 3. Create/Get ProtectQA Internal Enterprise
  insert into public.organizations (
    name,
    slug,
    plan_tier,
    plan_status,
    is_internal_test,
    billing_mode,
    created_at,
    updated_at
  )
  values (
    'ProtectQA Internal Enterprise',
    'protectqa-internal-enterprise',
    'ENTERPRISE',
    'ACTIVE',
    true,
    'COMPED',
    now(),
    now()
  )
  on conflict (slug) do update
  set
    plan_tier = 'ENTERPRISE',
    plan_status = 'ACTIVE',
    is_internal_test = true,
    billing_mode = 'COMPED',
    updated_at = now()
  returning id into v_enterprise_org_id;

  -- 4. Add superuser as admin to all internal test orgs (if superuser exists)
  if v_first_superuser_id is not null then
    -- Sandbox org membership
    insert into public.org_members (
      org_id,
      user_id,
      role,
      created_at
    )
    values (
      v_sandbox_org_id,
      v_first_superuser_id,
      'OWNER',
      now()
    )
    on conflict (org_id, user_id) do nothing;

    -- Team org membership
    insert into public.org_members (
      org_id,
      user_id,
      role,
      created_at
    )
    values (
      v_team_org_id,
      v_first_superuser_id,
      'OWNER',
      now()
    )
    on conflict (org_id, user_id) do nothing;

    -- Enterprise org membership
    insert into public.org_members (
      org_id,
      user_id,
      role,
      created_at
    )
    values (
      v_enterprise_org_id,
      v_first_superuser_id,
      'OWNER',
      now()
    )
    on conflict (org_id, user_id) do nothing;
  end if;

  raise notice 'Internal test orgs created/updated:';
  raise notice '  Sandbox: %', v_sandbox_org_id;
  raise notice '  Team: %', v_team_org_id;
  raise notice '  Enterprise: %', v_enterprise_org_id;
  if v_first_superuser_id is not null then
    raise notice '  Superuser % added as owner to all orgs', v_first_superuser_id;
  else
    raise notice '  No superuser found - orgs created but no memberships added';
  end if;
end;
$$;


-- Enterprise Entitlements System
-- Phase 1: Foundation - org_entitlements table
-- This table stores feature entitlements per organization based on tier

-- Create org_entitlements table
create table if not exists public.org_entitlements (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  tier text not null check (tier in ('SANDBOX', 'TEAM', 'ENTERPRISE')) default 'SANDBOX',
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create index for tier queries
create index if not exists idx_org_entitlements_tier on public.org_entitlements(tier);

-- Create trigger for updated_at
create trigger trg_org_entitlements_updated_at
before update on public.org_entitlements
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.org_entitlements enable row level security;

-- RLS policy: org members can view their org's entitlements
create policy "org_entitlements_select_if_member"
on public.org_entitlements for select
using (public.is_org_member(org_id));

-- RLS policy: only owners/admins can update entitlements (for future manual overrides)
create policy "org_entitlements_update_if_admin"
on public.org_entitlements for update
using (
  exists (
    select 1 from public.org_members
    where org_id = org_entitlements.org_id
      and user_id = auth.uid()
      and role in ('OWNER', 'ADMIN')
  )
);

-- Function to initialize entitlements for an org based on tier
create or replace function public.init_org_entitlements(
  p_org_id uuid,
  p_tier text default 'SANDBOX'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_features jsonb;
begin
  -- Set features based on tier
  case p_tier
    when 'SANDBOX' then
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
        'scim', false
      );
    
    when 'TEAM' then
      v_features := jsonb_build_object(
        'enterpriseGovernance', false,
        'approvalsWorkflow', false,
        'auditPacksAdvanced', false,
        'legalHold', false,
        'issueDecisions', true,  -- Team gets basic decisions
        'reviewerSignoff', false,
        'cases', false,
        'integrations', false,
        'batchIngestion', true,  -- Team gets batch ingestion
        'connectorsS3', false,
        'connectorsDropbox', false,
        'connectorsGDrive', false,
        'ssoSaml', false,
        'scim', false
      );
    
    when 'ENTERPRISE' then
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
        'ssoSaml', false,  -- Future-ready but not enabled by default
        'scim', false       -- Future-ready but not enabled by default
      );
    
    else
      -- Default to SANDBOX if unknown tier
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
        'scim', false
      );
  end case;

  -- Insert or update entitlements
  insert into public.org_entitlements (org_id, tier, features)
  values (p_org_id, p_tier, v_features)
  on conflict (org_id) do update
  set tier = excluded.tier,
      features = excluded.features,
      updated_at = now();
end;
$$;

-- Function to get org entitlements (with caching-friendly structure)
create or replace function public.get_org_entitlements(p_org_id uuid)
returns table (
  org_id uuid,
  tier text,
  features jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    e.org_id,
    e.tier,
    e.features
  from public.org_entitlements e
  where e.org_id = p_org_id;
  
  -- If no entitlements exist, initialize from org's plan_tier
  if not found then
    declare
      v_tier text;
    begin
      select plan_tier into v_tier
      from public.organizations
      where id = p_org_id;
      
      if v_tier is not null then
        perform public.init_org_entitlements(p_org_id, v_tier);
        
        return query
        select
          e.org_id,
          e.tier,
          e.features
        from public.org_entitlements e
        where e.org_id = p_org_id;
      end if;
    end;
  end if;
end;
$$;

-- Function to check if org has a specific feature
create or replace function public.has_entitlement(
  p_org_id uuid,
  p_feature_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_features jsonb;
begin
  select features into v_features
  from public.org_entitlements
  where org_id = p_org_id;
  
  -- If no entitlements exist, initialize from org's plan_tier
  if v_features is null then
    declare
      v_tier text;
    begin
      select plan_tier into v_tier
      from public.organizations
      where id = p_org_id;
      
      if v_tier is not null then
        perform public.init_org_entitlements(p_org_id, v_tier);
        
        select features into v_features
        from public.org_entitlements
        where org_id = p_org_id;
      end if;
    end;
  end if;
  
  -- Check if feature is enabled
  return coalesce((v_features->>p_feature_key)::boolean, false);
end;
$$;

-- Grant execute permissions
grant execute on function public.init_org_entitlements(uuid, text) to authenticated;
grant execute on function public.get_org_entitlements(uuid) to authenticated;
grant execute on function public.has_entitlement(uuid, text) to authenticated;

-- Initialize entitlements for existing orgs based on their plan_tier
do $$
declare
  v_org record;
begin
  for v_org in
    select id, plan_tier
    from public.organizations
    where id not in (select org_id from public.org_entitlements)
  loop
    perform public.init_org_entitlements(v_org.id, coalesce(v_org.plan_tier, 'SANDBOX'));
  end loop;
end;
$$;

-- Trigger to auto-initialize entitlements when a new org is created
create or replace function public.auto_init_org_entitlements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.init_org_entitlements(
    new.id,
    coalesce(new.plan_tier, 'SANDBOX')
  );
  return new;
end;
$$;

-- Create trigger (only if it doesn't exist)
drop trigger if exists trg_org_entitlements_auto_init on public.organizations;
create trigger trg_org_entitlements_auto_init
after insert on public.organizations
for each row execute function public.auto_init_org_entitlements();

-- Trigger to update entitlements when org tier changes
create or replace function public.update_org_entitlements_on_tier_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only update if tier actually changed
  if old.plan_tier is distinct from new.plan_tier then
    perform public.init_org_entitlements(
      new.id,
      coalesce(new.plan_tier, 'SANDBOX')
    );
  end if;
  return new;
end;
$$;

-- Create trigger (only if it doesn't exist)
drop trigger if exists trg_org_entitlements_on_tier_change on public.organizations;
create trigger trg_org_entitlements_on_tier_change
after update of plan_tier on public.organizations
for each row execute function public.update_org_entitlements_on_tier_change();


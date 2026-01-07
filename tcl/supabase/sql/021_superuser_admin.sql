-- Superuser & Admin Tools
-- Adds superuser role, internal test org flags, and admin audit logging

-- 1. Add role enum to profiles table (profiles references auth.users)
alter table public.profiles
add column if not exists role text not null default 'USER' check (role in ('USER', 'SUPERUSER'));

create index if not exists idx_profiles_role on public.profiles(role);

-- 2. Add internal test and billing mode to organizations
alter table public.organizations
add column if not exists is_internal_test boolean not null default false,
add column if not exists billing_mode text not null default 'STRIPE' check (billing_mode in ('STRIPE', 'COMPED'));

create index if not exists idx_orgs_internal_test on public.organizations(is_internal_test);
create index if not exists idx_orgs_billing_mode on public.organizations(billing_mode);

-- 3. Admin audit log table
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_org_id uuid references public.organizations(id) on delete set null,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_actor on public.admin_audit_log(actor_user_id);
create index if not exists idx_admin_audit_target_org on public.admin_audit_log(target_org_id);
create index if not exists idx_admin_audit_created_at on public.admin_audit_log(created_at desc);

-- Enable RLS on admin_audit_log
alter table public.admin_audit_log enable row level security;

-- RLS policy: Only superusers can view audit logs
create policy "admin_audit_log_select_superuser"
on public.admin_audit_log for select
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'SUPERUSER'
  )
);

-- Function to log admin actions (called from backend)
create or replace function public.log_admin_action(
  p_actor_user_id uuid,
  p_action text,
  p_target_org_id uuid default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_log_id uuid;
begin
  insert into public.admin_audit_log (
    actor_user_id,
    action,
    target_org_id,
    metadata_json
  )
  values (
    p_actor_user_id,
    p_action,
    p_target_org_id,
    p_metadata_json
  )
  returning id into v_log_id;
  
  return v_log_id;
end;
$$;


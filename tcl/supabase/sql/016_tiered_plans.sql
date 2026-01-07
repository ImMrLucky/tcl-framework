-- Tiered Plans Foundation
-- Adds plan management and usage tracking to organizations

-- Add plan-related columns to organizations table
-- Note: Existing 'plan' column (default 'trial') is kept for backwards compatibility
alter table public.organizations
add column if not exists plan_tier text not null default 'SANDBOX' check (plan_tier in ('SANDBOX', 'TEAM', 'ENTERPRISE')),
add column if not exists plan_status text not null default 'ACTIVE' check (plan_status in ('ACTIVE', 'PAST_DUE', 'CANCELED')),
add column if not exists plan_changed_at timestamptz,
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists enterprise_contract_id text,
add column if not exists features_override_json jsonb;

-- Migrate existing 'plan' values to plan_tier if needed
-- 'trial' -> 'SANDBOX', others can be set manually
update public.organizations
set plan_tier = 'SANDBOX'
where plan_tier = 'SANDBOX' and (plan = 'trial' or plan is null);

-- Create index for plan queries
create index if not exists idx_orgs_plan_tier on public.organizations(plan_tier);
create index if not exists idx_orgs_plan_status on public.organizations(plan_status);

-- org_usage_daily table for tracking daily usage metrics
create table if not exists public.org_usage_daily (
  org_id uuid not null references public.organizations(id) on delete cascade,
  date date not null default current_date,
  analysis_runs int not null default 0,
  api_calls int not null default 0,
  uploads_count int not null default 0,
  uploads_bytes bigint not null default 0,
  webhook_deliveries int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, date)
);

create trigger trg_org_usage_daily_updated_at
before update on public.org_usage_daily
for each row execute function public.set_updated_at();

create index if not exists idx_org_usage_daily_org_id on public.org_usage_daily(org_id);
create index if not exists idx_org_usage_daily_date on public.org_usage_daily(date desc);

-- Enable RLS on org_usage_daily
alter table public.org_usage_daily enable row level security;

-- RLS policy: org members can view their org's usage
create policy "org_usage_daily_select_if_member"
on public.org_usage_daily for select
using (public.is_org_member(org_id));

-- Function to get or create today's usage record
-- Returns a single row (table function)
create or replace function public.get_or_create_usage_today(p_org_id uuid)
returns table (
  org_id uuid,
  date date,
  analysis_runs int,
  api_calls int,
  uploads_count int,
  uploads_bytes bigint,
  webhook_deliveries int,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
as $$
declare
  v_usage public.org_usage_daily;
begin
  -- Try to get existing record
  select * into v_usage
  from public.org_usage_daily
  where org_id = p_org_id
    and date = current_date;
  
  -- If not found, create it
  if not found then
    insert into public.org_usage_daily (org_id, date)
    values (p_org_id, current_date)
    returning * into v_usage;
  end if;
  
  -- Return as table
  return query select
    v_usage.org_id,
    v_usage.date,
    v_usage.analysis_runs,
    v_usage.api_calls,
    v_usage.uploads_count,
    v_usage.uploads_bytes,
    v_usage.webhook_deliveries,
    v_usage.created_at,
    v_usage.updated_at;
end;
$$;


-- Billing Downgrade Support
-- Adds plan_downgrade_at field for scheduling downgrades

alter table public.organizations
add column if not exists plan_downgrade_at timestamptz;

create index if not exists idx_organizations_downgrade_at 
on public.organizations(plan_downgrade_at) 
where plan_downgrade_at is not null;

-- Function to apply scheduled downgrades
create or replace function public.apply_scheduled_downgrades()
returns int
language plpgsql
as $$
declare
  downgrade_count int := 0;
begin
  -- Find organizations scheduled for downgrade where the date has passed
  update public.organizations
  set 
    plan_tier = 'SANDBOX',
    plan_status = 'ACTIVE',
    plan_downgrade_at = null,
    plan_changed_at = now()
  where 
    plan_downgrade_at is not null
    and plan_downgrade_at <= now()
    and plan_tier != 'SANDBOX';
  
  get diagnostics downgrade_count = row_count;
  
  return downgrade_count;
end;
$$;


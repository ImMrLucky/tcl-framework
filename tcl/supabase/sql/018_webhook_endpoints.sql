-- Webhook Endpoints
-- Stores webhook configuration for organizations

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  secret_hash text not null, -- SHA256 hash of webhook secret
  enabled boolean not null default true,
  mode text not null check (mode in ('SANDBOX', 'PROD')) default 'SANDBOX',
  events text[] not null default array['analysis.completed'], -- Event types to subscribe to
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_delivered_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  delivery_count int not null default 0,
  failure_count int not null default 0
);

create index if not exists idx_webhook_endpoints_org_id on public.webhook_endpoints(org_id);
create index if not exists idx_webhook_endpoints_mode on public.webhook_endpoints(mode);
create index if not exists idx_webhook_endpoints_enabled on public.webhook_endpoints(enabled) where enabled = true;

-- Update timestamps trigger
create trigger trg_webhook_endpoints_updated_at
before update on public.webhook_endpoints
for each row execute function public.set_updated_at();

-- RLS policies
alter table public.webhook_endpoints enable row level security;

-- View: All org members can view webhooks for their org
create policy "webhook_endpoints_select_org_members"
on public.webhook_endpoints for select
using (
  exists (
    select 1 from public.org_members
    where org_members.org_id = webhook_endpoints.org_id
      and org_members.user_id = auth_uid()
  )
);

-- Create/Update: Owner, Admin, Compliance roles
create policy "webhook_endpoints_insert_admin"
on public.webhook_endpoints for insert
with check (
  exists (
    select 1 from public.org_members
    where org_members.org_id = webhook_endpoints.org_id
      and org_members.user_id = auth_uid()
      and org_members.role in ('owner', 'admin', 'compliance')
  )
);

create policy "webhook_endpoints_update_admin"
on public.webhook_endpoints for update
using (
  exists (
    select 1 from public.org_members
    where org_members.org_id = webhook_endpoints.org_id
      and org_members.user_id = auth_uid()
      and org_members.role in ('owner', 'admin', 'compliance')
  )
);

-- Delete: Owner, Admin only
create policy "webhook_endpoints_delete_admin"
on public.webhook_endpoints for delete
using (
  exists (
    select 1 from public.org_members
    where org_members.org_id = webhook_endpoints.org_id
      and org_members.user_id = auth_uid()
      and org_members.role in ('owner', 'admin')
  )
);


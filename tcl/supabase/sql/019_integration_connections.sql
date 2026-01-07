-- Integration Connections
-- Stores connection configurations for cloud storage and batch upload integrations

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('S3', 'GDRIVE', 'DROPBOX', 'SHAREPOINT', 'BATCH_UPLOAD')),
  status text not null check (status in ('DISCONNECTED', 'CONNECTED', 'ERROR')) default 'DISCONNECTED',
  config_json jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz,
  unique(org_id, type) -- One connection per type per org
);

create index if not exists idx_integration_connections_org_id on public.integration_connections(org_id);
create index if not exists idx_integration_connections_type on public.integration_connections(type);
create index if not exists idx_integration_connections_status on public.integration_connections(status);

-- Update timestamps trigger
create trigger trg_integration_connections_updated_at
before update on public.integration_connections
for each row execute function public.set_updated_at();

-- RLS policies
alter table public.integration_connections enable row level security;

-- View: All org members can view connections for their org
create policy "integration_connections_select_org_members"
on public.integration_connections for select
using (
  exists (
    select 1 from public.org_members
    where org_members.org_id = integration_connections.org_id
      and org_members.user_id = auth_uid()
  )
);

-- Create/Update: Owner, Admin, Compliance roles
create policy "integration_connections_insert_admin"
on public.integration_connections for insert
with check (
  exists (
    select 1 from public.org_members
    where org_members.org_id = integration_connections.org_id
      and org_members.user_id = auth_uid()
      and org_members.role in ('owner', 'admin', 'compliance')
  )
);

create policy "integration_connections_update_admin"
on public.integration_connections for update
using (
  exists (
    select 1 from public.org_members
    where org_members.org_id = integration_connections.org_id
      and org_members.user_id = auth_uid()
      and org_members.role in ('owner', 'admin', 'compliance')
  )
);

-- Delete: Owner, Admin only
create policy "integration_connections_delete_admin"
on public.integration_connections for delete
using (
  exists (
    select 1 from public.org_members
    where org_members.org_id = integration_connections.org_id
      and org_members.user_id = auth_uid()
      and org_members.role in ('owner', 'admin')
  )
);


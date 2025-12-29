-- Enterprise Trial & SDK Schema
-- Adds projects, environments, conversations, evaluations, and usage tracking

-- projects (logical grouping inside an org)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, slug)
);

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create index if not exists idx_projects_org_id on public.projects(org_id);

-- project_envs (sandbox, production, etc.)
create table if not exists public.project_envs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null check (env in ('sandbox', 'production')),
  limits jsonb not null default '{"evaluations_per_month": 1000, "conversations_per_month": 500}'::jsonb,
  created_at timestamptz not null default now(),
  unique(project_id, env)
);

create index if not exists idx_project_envs_project_id on public.project_envs(project_id);

-- Update api_keys to include project_id and env
alter table public.api_keys
add column if not exists project_id uuid references public.projects(id) on delete cascade,
add column if not exists env text not null default 'sandbox' check (env in ('sandbox', 'production'));

create index if not exists idx_api_keys_project_id on public.api_keys(project_id);

-- conversations (call transcripts, chats, emails)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null default 'sandbox',
  external_id text, -- optional id from customer system
  title text,
  content text not null, -- full transcript/content
  metadata jsonb not null default '{}'::jsonb, -- agent_id, customer_id, call_date, etc.
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_conversations_org_id on public.conversations(org_id);
create index if not exists idx_conversations_project_id on public.conversations(project_id);
create index if not exists idx_conversations_created_at on public.conversations(created_at desc);

-- evaluations (results of running ProtectQA on a conversation)
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  env text not null default 'sandbox',
  scores jsonb not null default '{}'::jsonb, -- truth, consistency, coherence, overall
  refusal boolean not null default false,
  scorer_id text,
  engine_version text,
  latency_ms int,
  report jsonb not null default '{}'::jsonb, -- full report with claims, contradictions, etc.
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_evaluations_org_id on public.evaluations(org_id);
create index if not exists idx_evaluations_project_id on public.evaluations(project_id);
create index if not exists idx_evaluations_conversation_id on public.evaluations(conversation_id);
create index if not exists idx_evaluations_created_at on public.evaluations(created_at desc);

-- usage_daily (daily usage tracking per org/project/env)
create table if not exists public.usage_daily (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null default 'sandbox',
  date date not null,
  evaluations_count int not null default 0,
  conversations_count int not null default 0,
  created_at timestamptz not null default now(),
  unique(org_id, project_id, env, date)
);

create index if not exists idx_usage_daily_org_id on public.usage_daily(org_id);
create index if not exists idx_usage_daily_project_id on public.usage_daily(project_id);
create index if not exists idx_usage_daily_date on public.usage_daily(date desc);

-- Helper function: get default project for org
create or replace function public.get_default_project(p_org_id uuid)
returns uuid
language sql stable
as $$
  select id
  from public.projects
  where org_id = p_org_id
    and is_default = true
  limit 1;
$$;

-- Helper function: ensure default project exists
create or replace function public.ensure_default_project(p_org_id uuid, p_user_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_project_id uuid;
begin
  -- Check if default project exists
  select id into v_project_id
  from public.projects
  where org_id = p_org_id
    and is_default = true
  limit 1;

  -- Create if doesn't exist
  if v_project_id is null then
    insert into public.projects (org_id, name, slug, is_default)
    values (
      p_org_id,
      'Default Project',
      'default',
      true
    )
    returning id into v_project_id;

    -- Create sandbox environment
    insert into public.project_envs (project_id, env, limits)
    values (
      v_project_id,
      'sandbox',
      '{"evaluations_per_month": 1000, "conversations_per_month": 500}'::jsonb
    );
  end if;

  return v_project_id;
end;
$$;

-- RLS Policies for Enterprise Tables

alter table public.projects enable row level security;
alter table public.project_envs enable row level security;
alter table public.conversations enable row level security;
alter table public.evaluations enable row level security;
alter table public.usage_daily enable row level security;

-- projects policies
create policy "projects_select_if_member"
on public.projects for select
using (public.is_org_member(org_id));

create policy "projects_insert_member"
on public.projects for insert
with check (public.org_role(org_id) in ('owner','admin','member'));

create policy "projects_update_admin"
on public.projects for update
using (public.org_role(org_id) in ('owner','admin'))
with check (public.org_role(org_id) in ('owner','admin'));

create policy "projects_delete_owner"
on public.projects for delete
using (public.org_role(org_id) = 'owner');

-- project_envs policies
create policy "project_envs_select_if_member"
on public.project_envs for select
using (exists (
  select 1 from public.projects p
  where p.id = project_id
    and public.is_org_member(p.org_id)
));

create policy "project_envs_insert_admin"
on public.project_envs for insert
with check (exists (
  select 1 from public.projects p
  where p.id = project_id
    and public.org_role(p.org_id) in ('owner','admin')
));

-- conversations policies
create policy "conversations_select_if_member"
on public.conversations for select
using (public.is_org_member(org_id));

create policy "conversations_insert_member"
on public.conversations for insert
with check (public.org_role(org_id) in ('owner','admin','member'));

create policy "conversations_update_member"
on public.conversations for update
using (public.org_role(org_id) in ('owner','admin','member'))
with check (public.org_role(org_id) in ('owner','admin','member'));

create policy "conversations_delete_admin"
on public.conversations for delete
using (public.org_role(org_id) in ('owner','admin'));

-- evaluations policies
create policy "evaluations_select_if_member"
on public.evaluations for select
using (public.is_org_member(org_id));

create policy "evaluations_insert_member"
on public.evaluations for insert
with check (public.org_role(org_id) in ('owner','admin','member'));

create policy "evaluations_update_member"
on public.evaluations for update
using (public.org_role(org_id) in ('owner','admin','member'))
with check (public.org_role(org_id) in ('owner','admin','member'));

create policy "evaluations_delete_admin"
on public.evaluations for delete
using (public.org_role(org_id) in ('owner','admin'));

-- usage_daily policies (read-only for members)
create policy "usage_daily_select_if_member"
on public.usage_daily for select
using (public.is_org_member(org_id));

-- Note: usage_daily inserts are done by backend/service_role


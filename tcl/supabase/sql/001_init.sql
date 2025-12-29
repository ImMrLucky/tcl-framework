-- Enable UUIDs
create extension if not exists "pgcrypto";

-- Update timestamps
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Current auth user id helper
create or replace function public.auth_uid()
returns uuid
language sql stable
as $$
  select auth.uid();
$$;

-- organizations
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_org_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

-- profiles (per-user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  company_role text,
  company_industry text,
  call_operation text,
  primary_use_case text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- org_members (RBAC)
create table if not exists public.org_members (
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- api_keys (hashed keys for SDK/backends)
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  prefix text not null, -- first 6-10 chars for display
  scopes text[] not null default array['validate:write','validate:read'],
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_api_keys_org_id on public.api_keys(org_id);

-- sources (customer-provided evidence snippets/docs)
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,              -- optional id from customer system
  title text,
  text text not null,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_sources_org_id on public.sources(org_id);

-- validations (one click of "Validate")
create table if not exists public.validations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id),
  question text not null,
  answer text,
  options jsonb not null default '{}'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  refusal boolean not null default false,
  scorer_id text,
  engine_version text,
  latency_ms int,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_validations_org_id on public.validations(org_id);
create index if not exists idx_validations_created_at on public.validations(created_at desc);

-- audit_log (enterprise requirement)
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  actor_api_key_id uuid references public.api_keys(id),
  action text not null, -- e.g. "validation.create", "apikey.create"
  target_type text,
  target_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_org on public.audit_log(org_id);
create index if not exists idx_audit_created_at on public.audit_log(created_at desc);


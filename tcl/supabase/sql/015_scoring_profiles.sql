-- Scoring Profiles Schema
-- Allows admins to create and manage scoring configuration profiles

-- scoring_profiles table
create table if not exists public.scoring_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default false,
  risk_ranking_config jsonb not null, -- risk-ranking.json structure
  issue_scoring_config jsonb not null, -- issue-scoring.json structure
  config_hash text, -- Computed hash of the config bundle
  version text not null default '1.0.0',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  
  -- Ensure unique name per org
  unique(org_id, name)
);

create index if not exists idx_scoring_profiles_org_id on public.scoring_profiles(org_id);
create index if not exists idx_scoring_profiles_is_active on public.scoring_profiles(is_active);
create index if not exists idx_scoring_profiles_created_at on public.scoring_profiles(created_at desc);

-- Update trigger
create trigger trg_scoring_profiles_updated_at
before update on public.scoring_profiles
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.scoring_profiles enable row level security;

-- RLS Policies
create policy "scoring_profiles_select_if_member"
on public.scoring_profiles for select
using (public.is_org_member(org_id));

create policy "scoring_profiles_insert_if_admin"
on public.scoring_profiles for insert
with check (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin')
);

create policy "scoring_profiles_update_if_admin"
on public.scoring_profiles for update
using (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin')
)
with check (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin')
);

create policy "scoring_profiles_delete_if_admin"
on public.scoring_profiles for delete
using (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin')
);


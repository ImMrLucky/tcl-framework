-- Policy Library Schema
-- Supports versioning, activation, and linking to issues

-- policies table
create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  version text not null default '1.0.0',
  content text not null, -- Full policy text/content
  metadata jsonb not null default '{}'::jsonb, -- Additional metadata (tags, categories, etc.)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  archived_at timestamptz,
  
  -- Ensure unique name per org (for versioning, we'll use a separate versioning strategy)
  unique(org_id, name, version)
);

create index if not exists idx_policies_org_id on public.policies(org_id);
create index if not exists idx_policies_status on public.policies(status);
create index if not exists idx_policies_name on public.policies(name);
create index if not exists idx_policies_created_at on public.policies(created_at desc);

-- policy_sources table (links policies to evidence sources)
create table if not exists public.policy_sources (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  section text, -- Optional section reference within the policy
  relevance_score numeric, -- Optional relevance score (0-1)
  created_at timestamptz not null default now(),
  
  unique(policy_id, source_id)
);

create index if not exists idx_policy_sources_policy_id on public.policy_sources(policy_id);
create index if not exists idx_policy_sources_source_id on public.policy_sources(source_id);

-- issue_policy_links table (links issues to policies they reference/violate)
create table if not exists public.issue_policy_links (
  id uuid primary key default gen_random_uuid(),
  issue_id text not null, -- IssueV2.issueId (stable hash)
  policy_id uuid not null references public.policies(id) on delete cascade,
  link_type text not null default 'references' check (link_type in ('references', 'violates', 'complies')),
  section text, -- Optional section reference within the policy
  created_at timestamptz not null default now(),
  
  unique(issue_id, policy_id, link_type)
);

create index if not exists idx_issue_policy_links_issue_id on public.issue_policy_links(issue_id);
create index if not exists idx_issue_policy_links_policy_id on public.issue_policy_links(policy_id);
create index if not exists idx_issue_policy_links_link_type on public.issue_policy_links(link_type);

-- Update trigger for policies
create trigger trg_policies_updated_at
before update on public.policies
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.policies enable row level security;
alter table public.policy_sources enable row level security;
alter table public.issue_policy_links enable row level security;

-- RLS Policies for policies
create policy "policies_select_if_member"
on public.policies for select
using (public.is_org_member(org_id));

create policy "policies_insert_if_member"
on public.policies for insert
with check (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin', 'compliance', 'qa_reviewer')
);

create policy "policies_update_if_member"
on public.policies for update
using (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin', 'compliance', 'qa_reviewer')
)
with check (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin', 'compliance', 'qa_reviewer')
);

create policy "policies_delete_if_admin"
on public.policies for delete
using (
  public.is_org_member(org_id) and
  public.org_role(org_id) in ('owner', 'admin')
);

-- RLS Policies for policy_sources
create policy "policy_sources_select_if_member"
on public.policy_sources for select
using (
  exists (
    select 1 from public.policies p
    where p.id = policy_sources.policy_id
    and public.is_org_member(p.org_id)
  )
);

create policy "policy_sources_insert_if_member"
on public.policy_sources for insert
with check (
  exists (
    select 1 from public.policies p
    where p.id = policy_sources.policy_id
    and public.is_org_member(p.org_id)
    and public.org_role(p.org_id) in ('owner', 'admin', 'compliance', 'qa_reviewer')
  )
);

create policy "policy_sources_delete_if_member"
on public.policy_sources for delete
using (
  exists (
    select 1 from public.policies p
    where p.id = policy_sources.policy_id
    and public.is_org_member(p.org_id)
    and public.org_role(p.org_id) in ('owner', 'admin', 'compliance', 'qa_reviewer')
  )
);

-- RLS Policies for issue_policy_links
create policy "issue_policy_links_select_if_member"
on public.issue_policy_links for select
using (
  exists (
    select 1 from public.policies p
    where p.id = issue_policy_links.policy_id
    and public.is_org_member(p.org_id)
  )
);

create policy "issue_policy_links_insert_if_member"
on public.issue_policy_links for insert
with check (
  exists (
    select 1 from public.policies p
    where p.id = issue_policy_links.policy_id
    and public.is_org_member(p.org_id)
    and public.org_role(p.org_id) in ('owner', 'admin', 'compliance', 'qa_reviewer')
  )
);

create policy "issue_policy_links_delete_if_member"
on public.issue_policy_links for delete
using (
  exists (
    select 1 from public.policies p
    where p.id = issue_policy_links.policy_id
    and public.is_org_member(p.org_id)
    and public.org_role(p.org_id) in ('owner', 'admin', 'compliance', 'qa_reviewer')
  )
);


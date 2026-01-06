-- Issue Workflow Schema
-- Adds tables for issue triage: status, assignment, comments, and action log

-- issue_workflow (tracks status and assignment for each issue)
create table if not exists public.issue_workflow (
  issue_id text primary key, -- matches IssueV2.issueId (stable hash)
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE')),
  assignee_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_workflow_org_id on public.issue_workflow(org_id);
create index if not exists idx_issue_workflow_status on public.issue_workflow(status);
create index if not exists idx_issue_workflow_assignee on public.issue_workflow(assignee_user_id);
create index if not exists idx_issue_workflow_updated_at on public.issue_workflow(updated_at desc);

-- issue_comments (comments on issues)
create table if not exists public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id text not null references public.issue_workflow(issue_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_comments_issue_id on public.issue_comments(issue_id);
create index if not exists idx_issue_comments_org_id on public.issue_comments(org_id);
create index if not exists idx_issue_comments_created_at on public.issue_comments(created_at desc);

-- issue_actions_log (audit log of all actions on issues)
create table if not exists public.issue_actions_log (
  id uuid primary key default gen_random_uuid(),
  issue_id text not null references public.issue_workflow(issue_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in ('STATUS_CHANGE', 'ASSIGNMENT', 'COMMENT', 'BULK_STATUS_CHANGE', 'BULK_ASSIGNMENT')),
  payload_json jsonb not null default '{}'::jsonb, -- flexible payload for different action types
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_actions_log_issue_id on public.issue_actions_log(issue_id);
create index if not exists idx_issue_actions_log_org_id on public.issue_actions_log(org_id);
create index if not exists idx_issue_actions_log_action_type on public.issue_actions_log(action_type);
create index if not exists idx_issue_actions_log_created_at on public.issue_actions_log(created_at desc);

-- Trigger to update updated_at on issue_workflow
create trigger trg_issue_workflow_updated_at
before update on public.issue_workflow
for each row execute function public.set_updated_at();

-- RLS Policies
alter table public.issue_workflow enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_actions_log enable row level security;

-- Users can view workflow records for their org
create policy "Users can view issue_workflow for their org"
  on public.issue_workflow
  for select
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
  );

-- Users can update workflow records for their org
create policy "Users can update issue_workflow for their org"
  on public.issue_workflow
  for update
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
  );

-- Users can insert workflow records for their org
create policy "Users can insert issue_workflow for their org"
  on public.issue_workflow
  for insert
  with check (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
  );

-- Users can view comments for their org
create policy "Users can view issue_comments for their org"
  on public.issue_comments
  for select
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
  );

-- Users can insert comments for their org
create policy "Users can insert issue_comments for their org"
  on public.issue_comments
  for insert
  with check (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
    and actor_user_id = auth.uid()
  );

-- Users can view action log for their org
create policy "Users can view issue_actions_log for their org"
  on public.issue_actions_log
  for select
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
  );

-- Users can insert action log entries for their org
create policy "Users can insert issue_actions_log for their org"
  on public.issue_actions_log
  for insert
  with check (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
    and actor_user_id = auth.uid()
  );


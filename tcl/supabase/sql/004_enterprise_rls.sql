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


-- Enable RLS
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.api_keys enable row level security;
alter table public.sources enable row level security;
alter table public.validations enable row level security;
alter table public.audit_log enable row level security;

-- Helper Function: is_member(org)
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
  );
$$;

-- Helper Function: org_role(org)
create or replace function public.org_role(p_org uuid)
returns text
language sql stable
as $$
  select coalesce((
    select m.role
    from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
    limit 1
  ), 'none');
$$;

-- profiles policies
create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid());

create policy "profiles_upsert_own"
on public.profiles for insert
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

-- organizations policies
create policy "orgs_select_if_member"
on public.organizations for select
using (public.is_org_member(id));

-- org_members policies
create policy "org_members_select_if_member"
on public.org_members for select
using (public.is_org_member(org_id));

create policy "org_members_insert_admin"
on public.org_members for insert
with check (public.org_role(org_id) in ('owner','admin'));

create policy "org_members_update_admin"
on public.org_members for update
using (public.org_role(org_id) in ('owner','admin'))
with check (public.org_role(org_id) in ('owner','admin'));

create policy "org_members_delete_owner"
on public.org_members for delete
using (public.org_role(org_id) = 'owner');

-- sources policies
create policy "sources_select_if_member"
on public.sources for select
using (public.is_org_member(org_id));

create policy "sources_insert_member"
on public.sources for insert
with check (public.org_role(org_id) in ('owner','admin','member'));

create policy "sources_update_member"
on public.sources for update
using (public.org_role(org_id) in ('owner','admin','member'))
with check (public.org_role(org_id) in ('owner','admin','member'));

create policy "sources_delete_admin"
on public.sources for delete
using (public.org_role(org_id) in ('owner','admin'));

-- validations policies
create policy "validations_select_if_member"
on public.validations for select
using (public.is_org_member(org_id));

create policy "validations_insert_member"
on public.validations for insert
with check (public.org_role(org_id) in ('owner','admin','member'));

-- api_keys policies
create policy "api_keys_select_admin"
on public.api_keys for select
using (public.org_role(org_id) in ('owner','admin'));

create policy "api_keys_insert_admin"
on public.api_keys for insert
with check (public.org_role(org_id) in ('owner','admin'));

create policy "api_keys_update_admin"
on public.api_keys for update
using (public.org_role(org_id) in ('owner','admin'))
with check (public.org_role(org_id) in ('owner','admin'));

create policy "api_keys_delete_owner"
on public.api_keys for delete
using (public.org_role(org_id) = 'owner');

-- audit_log policies
create policy "audit_select_if_member"
on public.audit_log for select
using (public.is_org_member(org_id));

-- Note: audit_log insert is usually done by backend using service_role (bypasses RLS)
-- If you want client inserts, add an insert policy here


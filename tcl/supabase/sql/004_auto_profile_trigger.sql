-- Auto-create profile when user signs up
-- This trigger runs automatically when a user is created in auth.users
-- and creates a corresponding profile in public.profiles

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (
    new.id,
    new.email
  )
  on conflict (id) do update
  set email = new.email,
      updated_at = now();
  return new;
end;
$$;

-- Create trigger on auth.users
-- This will automatically create a profile when a user signs up
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


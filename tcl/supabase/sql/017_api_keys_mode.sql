-- API Keys Mode Support
-- Adds mode field and last_used_at tracking to api_keys table

-- Add mode field (maps to env: sandbox -> SANDBOX, production -> PROD)
alter table public.api_keys
add column if not exists mode text check (mode in ('SANDBOX', 'PROD')),
add column if not exists last_used_at timestamptz;

-- Migrate existing env values to mode
update public.api_keys
set mode = case 
  when env = 'sandbox' then 'SANDBOX'
  when env = 'production' then 'PROD'
  else 'SANDBOX'
end
where mode is null;

-- Set default mode for new keys
alter table public.api_keys
alter column mode set default 'SANDBOX';

-- Create index for mode queries
create index if not exists idx_api_keys_mode on public.api_keys(mode);
create index if not exists idx_api_keys_last_used on public.api_keys(last_used_at desc);

-- Function to update last_used_at when key is verified
create or replace function public.update_api_key_last_used(p_key_hash text)
returns void
language plpgsql
as $$
begin
  update public.api_keys
  set last_used_at = now()
  where key_hash = p_key_hash
    and is_active = true
    and revoked_at is null;
end;
$$;


-- Integration Layer Schema
-- Supports artifact-based ingestion, evidence sources, and integration connectors

-- ============================================================================
-- CONVERSATION ARTIFACTS
-- ============================================================================

create table if not exists public.conversation_artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null check (env in ('sandbox', 'production')),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  artifact_type text not null check (artifact_type in (
    'transcript_text',
    'chat_messages',
    'email_thread',
    'audio_recording',
    'attachment',
    'evidence_doc'
  )),
  content_text text,
  content_json jsonb not null default '{}'::jsonb,
  storage_ref jsonb not null default '{}'::jsonb,
  content_type text,
  filename text,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_artifacts_conv on public.conversation_artifacts(conversation_id);
create index if not exists idx_conversation_artifacts_org on public.conversation_artifacts(org_id, project_id, env);
create index if not exists idx_conversation_artifacts_type on public.conversation_artifacts(artifact_type);

-- ============================================================================
-- EVIDENCE SOURCES & ARTIFACTS
-- ============================================================================

create table if not exists public.evidence_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null check (env in ('sandbox', 'production')),
  name text not null,
  source_type text not null check (source_type in (
    's3',
    'dropbox',
    'upload',
    'api',
    'webhook'
  )),
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_evidence_sources_org on public.evidence_sources(org_id, project_id, env);

create table if not exists public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  evidence_source_id uuid not null references public.evidence_sources(id) on delete cascade,
  filename text,
  content_type text,
  storage_ref jsonb not null default '{}'::jsonb,
  extracted_text text,
  extracted_json jsonb not null default '{}'::jsonb,
  file_size bigint,
  checksum text,
  created_at timestamptz not null default now()
);

create index if not exists idx_evidence_artifacts_source on public.evidence_artifacts(evidence_source_id);
create index if not exists idx_evidence_artifacts_org on public.evidence_artifacts(org_id);

-- ============================================================================
-- INTEGRATIONS
-- ============================================================================

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null check (env in ('sandbox', 'production')),
  name text not null,
  integration_type text not null check (integration_type in (
    'webhook_ingest',
    'webhook_export',
    'slack_alert',
    'teams_alert',
    's3_drop',
    'zendesk',
    'salesforce',
    'dropbox',
    'amazon_connect'
  )),
  config jsonb not null default '{}'::jsonb,
  secrets jsonb not null default '{}'::jsonb, -- encrypted in application layer
  is_active boolean not null default true,
  is_beta boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_integrations_org on public.integrations(org_id, project_id, env);
create index if not exists idx_integrations_type on public.integrations(integration_type);

-- Webhook path tokens for ingest endpoints
create table if not exists public.webhook_tokens (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  path_token text not null unique,
  secret text not null, -- HMAC secret
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_tokens_path on public.webhook_tokens(path_token);
create index if not exists idx_webhook_tokens_integration on public.webhook_tokens(integration_id);

-- ============================================================================
-- REAL-TIME SESSIONS
-- ============================================================================

create table if not exists public.realtime_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null check (env in ('sandbox', 'production')),
  channel text not null check (channel in ('call', 'chat', 'email', 'other')),
  conversation_id uuid references public.conversations(id),
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'finalized', 'abandoned')),
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_realtime_sessions_org on public.realtime_sessions(org_id, project_id, env);
create index if not exists idx_realtime_sessions_status on public.realtime_sessions(status);

-- ============================================================================
-- DELIVERY ATTEMPTS (Exports & Retries)
-- ============================================================================

create table if not exists public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  evaluation_id uuid references public.evaluations(id),
  attempt_number int not null default 1,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'retrying')),
  payload jsonb not null default '{}'::jsonb,
  response_status int,
  response_body text,
  error_message text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_delivery_attempts_integration on public.delivery_attempts(integration_id);
create index if not exists idx_delivery_attempts_status on public.delivery_attempts(status, next_retry_at);
create index if not exists idx_delivery_attempts_evaluation on public.delivery_attempts(evaluation_id);

-- ============================================================================
-- IDEMPOTENCY TRACKING
-- ============================================================================

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key_hash text not null, -- SHA256 of (provider + external_id)
  provider text not null,
  external_id text not null,
  conversation_id uuid references public.conversations(id),
  created_at timestamptz not null default now(),
  unique(org_id, key_hash)
);

create index if not exists idx_idempotency_keys_hash on public.idempotency_keys(key_hash);
create index if not exists idx_idempotency_keys_org on public.idempotency_keys(org_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

create trigger trg_evidence_sources_updated_at
before update on public.evidence_sources
for each row execute function public.set_updated_at();

create trigger trg_integrations_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

-- ============================================================================
-- UPDATE CONVERSATIONS TABLE
-- ============================================================================

-- Add raw_text column if it doesn't exist (for artifact-based normalization)
-- The existing 'content' column remains for backward compatibility
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'conversations' 
    and column_name = 'raw_text'
  ) then
    alter table public.conversations 
    add column raw_text text;
    
    -- Populate raw_text from content for existing records
    update public.conversations 
    set raw_text = content 
    where raw_text is null and content is not null;
  end if;
end $$;

-- Make content nullable (since artifacts can populate raw_text instead)
alter table public.conversations 
alter column content drop not null;


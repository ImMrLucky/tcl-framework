-- Row Level Security for Integration Layer Tables

-- ============================================================================
-- CONVERSATION ARTIFACTS
-- ============================================================================

alter table public.conversation_artifacts enable row level security;

create policy "Users can view artifacts in their org"
  on public.conversation_artifacts
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = conversation_artifacts.org_id
      and om.user_id = auth.uid()
    )
  );

create policy "Users can create artifacts in their org"
  on public.conversation_artifacts
  for insert
  with check (
    exists (
      select 1 from public.org_members om
      where om.org_id = conversation_artifacts.org_id
      and om.user_id = auth.uid()
    )
  );

create policy "Users can update artifacts in their org"
  on public.conversation_artifacts
  for update
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = conversation_artifacts.org_id
      and om.user_id = auth.uid()
    )
  );

-- ============================================================================
-- EVIDENCE SOURCES
-- ============================================================================

alter table public.evidence_sources enable row level security;

create policy "Users can view evidence sources in their org"
  on public.evidence_sources
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = evidence_sources.org_id
      and om.user_id = auth.uid()
    )
  );

create policy "Users can manage evidence sources in their org"
  on public.evidence_sources
  for all
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = evidence_sources.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin', 'member')
    )
  );

-- ============================================================================
-- EVIDENCE ARTIFACTS
-- ============================================================================

alter table public.evidence_artifacts enable row level security;

create policy "Users can view evidence artifacts in their org"
  on public.evidence_artifacts
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = evidence_artifacts.org_id
      and om.user_id = auth.uid()
    )
  );

create policy "Users can manage evidence artifacts in their org"
  on public.evidence_artifacts
  for all
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = evidence_artifacts.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin', 'member')
    )
  );

-- ============================================================================
-- INTEGRATIONS
-- ============================================================================

alter table public.integrations enable row level security;

create policy "Users can view integrations in their org"
  on public.integrations
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = integrations.org_id
      and om.user_id = auth.uid()
    )
  );

create policy "Users can manage integrations in their org"
  on public.integrations
  for all
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = integrations.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin', 'member')
    )
  );

-- ============================================================================
-- WEBHOOK TOKENS
-- ============================================================================

alter table public.webhook_tokens enable row level security;

create policy "Users can view webhook tokens in their org"
  on public.webhook_tokens
  for select
  using (
    exists (
      select 1 from public.integrations i
      join public.org_members om on om.org_id = i.org_id
      where i.id = webhook_tokens.integration_id
      and om.user_id = auth.uid()
    )
  );

create policy "Users can manage webhook tokens in their org"
  on public.webhook_tokens
  for all
  using (
    exists (
      select 1 from public.integrations i
      join public.org_members om on om.org_id = i.org_id
      where i.id = webhook_tokens.integration_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin', 'member')
    )
  );

-- ============================================================================
-- REAL-TIME SESSIONS
-- ============================================================================

alter table public.realtime_sessions enable row level security;

create policy "Users can view realtime sessions in their org"
  on public.realtime_sessions
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = realtime_sessions.org_id
      and om.user_id = auth.uid()
    )
  );

create policy "Users can manage realtime sessions in their org"
  on public.realtime_sessions
  for all
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = realtime_sessions.org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin', 'member')
    )
  );

-- ============================================================================
-- DELIVERY ATTEMPTS
-- ============================================================================

alter table public.delivery_attempts enable row level security;

create policy "Users can view delivery attempts in their org"
  on public.delivery_attempts
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = delivery_attempts.org_id
      and om.user_id = auth.uid()
    )
  );

-- ============================================================================
-- IDEMPOTENCY KEYS
-- ============================================================================

alter table public.idempotency_keys enable row level security;

create policy "Users can view idempotency keys in their org"
  on public.idempotency_keys
  for select
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = idempotency_keys.org_id
      and om.user_id = auth.uid()
    )
  );

create policy "Service role can manage idempotency keys"
  on public.idempotency_keys
  for all
  using (true); -- Managed by backend service role


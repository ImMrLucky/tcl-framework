-- ============================================================================
-- Evidence System Phase 1 Migration
-- ============================================================================
-- Implements core evidence system with scopes, governance, and indexing
-- Part of ProtectQA Evidence/Policy System + Categories & "View By" Ordering
--
-- Phase 1 includes:
--   - evidence_items table (core evidence storage)
--   - evidence_chunks table (indexed chunks for retrieval)
--   - Org/project business context fields
--   - EvidenceSet storage in evaluations
--   - IssueV2 schema updates (primaryCategory, tags, transcriptSpans, evidenceRefs)
-- ============================================================================

-- ============================================================================
-- 1. ADD BUSINESS CONTEXT FIELDS TO ORGANIZATIONS
-- ============================================================================

alter table public.organizations
add column if not exists business_function_primary text check (business_function_primary in (
  'BILLING_SUPPORT',
  'CUSTOMER_SUPPORT_RETENTION',
  'SALES_ONBOARDING',
  'REGULATED_OPERATIONS',
  'MIXED',
  null
));

alter table public.organizations
add column if not exists industry_primary text check (industry_primary in (
  'FINANCE',
  'TELECOM',
  'HEALTHCARE',
  'INSURANCE',
  'SAAS',
  'RETAIL',
  'GOV',
  'OTHER',
  'UNKNOWN',
  null
));

alter table public.organizations
add column if not exists regions text[] default array[]::text[];

alter table public.organizations
add column if not exists default_lens text check (default_lens in (
  'regulatory_exposure',
  'financial_exposure',
  'customer_dispute_risk',
  'promise_commitment_risk',
  'privacy_security_risk',
  'operational_process_risk',
  'neutral_engine_order',
  null
));

alter table public.organizations
add column if not exists default_evidence_inclusion jsonb default '{"includeOrg": true, "includeProject": true, "includeTemplate": true}'::jsonb;

create index if not exists idx_organizations_business_function on public.organizations(business_function_primary);
create index if not exists idx_organizations_industry on public.organizations(industry_primary);

-- ============================================================================
-- 2. ADD BUSINESS CONTEXT FIELDS TO PROJECTS
-- ============================================================================

-- First, ensure projects table exists (check if it's in a later migration)
-- If projects table doesn't exist yet, this will be added in a separate migration
-- For now, we'll add these fields assuming projects table exists

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'projects') then
    alter table public.projects
    add column if not exists business_function_override text check (business_function_override in (
      'BILLING_SUPPORT',
      'CUSTOMER_SUPPORT_RETENTION',
      'SALES_ONBOARDING',
      'REGULATED_OPERATIONS',
      'MIXED',
      null
    ));

    alter table public.projects
    add column if not exists industry_override text check (industry_override in (
      'FINANCE',
      'TELECOM',
      'HEALTHCARE',
      'INSURANCE',
      'SAAS',
      'RETAIL',
      'GOV',
      'OTHER',
      'UNKNOWN',
      null
    ));

    alter table public.projects
    add column if not exists default_template_id uuid;

    alter table public.projects
    add column if not exists default_lens text check (default_lens in (
      'regulatory_exposure',
      'financial_exposure',
      'customer_dispute_risk',
      'promise_commitment_risk',
      'privacy_security_risk',
      'operational_process_risk',
      'neutral_engine_order',
      null
    ));
  end if;
end $$;

-- ============================================================================
-- 3. EVIDENCE_ITEMS TABLE
-- ============================================================================

create table if not exists public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  template_id uuid, -- references templates table if it exists
  
  -- Scope: ORG, PROJECT, TEMPLATE, CONVERSATION
  scope text not null check (scope in ('ORG', 'PROJECT', 'TEMPLATE', 'CONVERSATION')),
  
  -- Source type
  source_type text not null check (source_type in (
    'POLICY',
    'RULESET',
    'KNOWLEDGE',
    'ACCOUNT_FACTS',
    'LEGAL',
    'URL_LINK',
    'SYSTEM_EXPORT'
  )),
  
  -- Metadata
  title text not null,
  description text,
  tags text[] default array[]::text[],
  regions text[] default array[]::text[], -- jurisdiction/regions this applies to
  
  -- Storage: FILE or LINK
  storage_kind text not null check (storage_kind in ('FILE', 'LINK')),
  
  -- File storage (if storage_kind = 'FILE')
  file_mime_type text,
  file_size_bytes bigint,
  file_sha256 text, -- SHA-256 hash of file content
  file_storage_path text, -- path in Supabase Storage (bucket/object_path)
  file_original_name text,
  
  -- Link storage (if storage_kind = 'LINK')
  link_url text,
  link_fetched_at timestamptz,
  link_sha256 text, -- SHA-256 of snapshot content
  link_snapshot_storage_path text, -- path to snapshot in storage
  
  -- Governance
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'DEPRECATED')),
  version text not null default '1.0.0',
  effective_from timestamptz,
  effective_to timestamptz,
  
  -- Audit
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  
  -- Indexing status
  index_status text not null default 'PENDING' check (index_status in ('PENDING', 'INDEXED', 'FAILED')),
  chunk_count int default 0,
  embedding_model text,
  index_error text,
  
  -- Rule metadata (for RULESET source_type)
  rule_meta jsonb default '{}'::jsonb -- { mustSay[], mustNotSay[], requiredDisclosures[], forbiddenClaims[], jurisdiction?, regexRules[] }
);

create index if not exists idx_evidence_items_org_id on public.evidence_items(org_id);
create index if not exists idx_evidence_items_project_id on public.evidence_items(project_id);
create index if not exists idx_evidence_items_conversation_id on public.evidence_items(conversation_id);
create index if not exists idx_evidence_items_scope on public.evidence_items(scope);
create index if not exists idx_evidence_items_status on public.evidence_items(status);
create index if not exists idx_evidence_items_source_type on public.evidence_items(source_type);
create index if not exists idx_evidence_items_index_status on public.evidence_items(index_status);
create index if not exists idx_evidence_items_tags on public.evidence_items using gin(tags);
create index if not exists idx_evidence_items_created_at on public.evidence_items(created_at desc);

-- Unique constraint: file_sha256 should be unique per org (prevent duplicates)
create unique index if not exists evidence_items_org_sha256_uidx 
  on public.evidence_items(org_id, file_sha256) 
  where file_sha256 is not null;

create trigger trg_evidence_items_updated_at
before update on public.evidence_items
for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. EVIDENCE_CHUNKS TABLE (for indexed retrieval)
-- ============================================================================

create table if not exists public.evidence_chunks (
  id uuid primary key default gen_random_uuid(),
  evidence_item_id uuid not null references public.evidence_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  
  -- Chunk metadata
  chunk_index int not null, -- order within document
  text text not null, -- chunk text content
  text_start_offset int, -- character offset in original document
  text_end_offset int,
  
  -- Metadata from source
  heading text, -- section heading if available
  metadata jsonb default '{}'::jsonb, -- additional metadata (page number, section, etc.)
  
  -- Embedding (stored as vector if pgvector extension available, otherwise as jsonb)
  embedding jsonb, -- vector embedding as array of numbers
  embedding_model text,
  
  -- Tags inherited from evidence_item
  tags text[] default array[]::text[],
  
  created_at timestamptz not null default now()
);

create index if not exists idx_evidence_chunks_evidence_item_id on public.evidence_chunks(evidence_item_id);
create index if not exists idx_evidence_chunks_org_id on public.evidence_chunks(org_id);
create index if not exists idx_evidence_chunks_tags on public.evidence_chunks using gin(tags);
create index if not exists idx_evidence_chunks_chunk_index on public.evidence_chunks(evidence_item_id, chunk_index);

-- ============================================================================
-- 5. UPDATE EVALUATIONS TABLE TO STORE EVIDENCE SET
-- ============================================================================

alter table public.evaluations
add column if not exists evidence_set jsonb default '{}'::jsonb; -- { orgEvidenceIds[], projectEvidenceIds[], conversationEvidenceIds[], templateEvidenceIds[], resolvedEvidenceIds[] }

alter table public.evaluations
add column if not exists evidence_diagnostics jsonb default '{}'::jsonb; -- { indexingFailures[], missingApprovals[], staleDocsUsed[], snapshotStatus[] }

alter table public.evaluations
add column if not exists template_id uuid;

alter table public.evaluations
add column if not exists simulation_mode boolean default false; -- admin-only: allows DRAFT evidence

create index if not exists idx_evaluations_template_id on public.evaluations(template_id);
create index if not exists idx_evaluations_simulation_mode on public.evaluations(simulation_mode);

-- ============================================================================
-- 6. EVIDENCE APPROVALS AUDIT TABLE (optional but recommended)
-- ============================================================================

create table if not exists public.evidence_approvals (
  id uuid primary key default gen_random_uuid(),
  evidence_item_id uuid not null references public.evidence_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  
  action text not null check (action in ('APPROVED', 'DEPRECATED', 'REJECTED')),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  notes text,
  
  created_at timestamptz not null default now()
);

create index if not exists idx_evidence_approvals_evidence_item_id on public.evidence_approvals(evidence_item_id);
create index if not exists idx_evidence_approvals_org_id on public.evidence_approvals(org_id);
create index if not exists idx_evidence_approvals_created_at on public.evidence_approvals(created_at desc);

-- ============================================================================
-- 7. HELPER FUNCTION: Resolve Evidence Set
-- ============================================================================

create or replace function public.resolve_evidence_set(
  p_org_id uuid,
  p_project_id uuid default null,
  p_template_id uuid default null,
  p_conversation_id uuid default null,
  p_simulation_mode boolean default false,
  p_include_org boolean default true,
  p_include_project boolean default true,
  p_include_template boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb := '{"orgEvidenceIds": [], "projectEvidenceIds": [], "conversationEvidenceIds": [], "templateEvidenceIds": [], "resolvedEvidenceIds": []}'::jsonb;
  v_now timestamptz := now();
  v_status_filter text := case when p_simulation_mode then 'DRAFT' else 'APPROVED' end;
begin
  -- Org-level evidence
  if p_include_org then
    select array_agg(id::text order by created_at desc)
    into v_result->'orgEvidenceIds'
    from public.evidence_items
    where org_id = p_org_id
      and scope = 'ORG'
      and status = v_status_filter
      and (effective_from is null or effective_from <= v_now)
      and (effective_to is null or effective_to >= v_now)
      and index_status = 'INDEXED';
  end if;
  
  -- Project-level evidence
  if p_include_project and p_project_id is not null then
    select array_agg(id::text order by created_at desc)
    into v_result->'projectEvidenceIds'
    from public.evidence_items
    where org_id = p_org_id
      and project_id = p_project_id
      and scope = 'PROJECT'
      and status = v_status_filter
      and (effective_from is null or effective_from <= v_now)
      and (effective_to is null or effective_to >= v_now)
      and index_status = 'INDEXED';
  end if;
  
  -- Template-level evidence
  if p_include_template and p_template_id is not null then
    select array_agg(id::text order by created_at desc)
    into v_result->'templateEvidenceIds'
    from public.evidence_items
    where org_id = p_org_id
      and template_id = p_template_id
      and scope = 'TEMPLATE'
      and status = v_status_filter
      and (effective_from is null or effective_from <= v_now)
      and (effective_to is null or effective_to >= v_now)
      and index_status = 'INDEXED';
  end if;
  
  -- Conversation-level evidence
  if p_conversation_id is not null then
    select array_agg(id::text order by created_at desc)
    into v_result->'conversationEvidenceIds'
    from public.evidence_items
    where org_id = p_org_id
      and conversation_id = p_conversation_id
      and scope = 'CONVERSATION'
      and status = v_status_filter
      and (effective_from is null or effective_from <= v_now)
      and (effective_to is null or effective_to >= v_now)
      and index_status = 'INDEXED';
  end if;
  
  -- Resolved evidence IDs (union of all)
  select array_agg(distinct id::text)
  into v_result->'resolvedEvidenceIds'
  from public.evidence_items
  where org_id = p_org_id
    and (
      (p_include_org and scope = 'ORG')
      or (p_include_project and p_project_id is not null and project_id = p_project_id and scope = 'PROJECT')
      or (p_include_template and p_template_id is not null and template_id = p_template_id and scope = 'TEMPLATE')
      or (p_conversation_id is not null and conversation_id = p_conversation_id and scope = 'CONVERSATION')
    )
    and status = v_status_filter
    and (effective_from is null or effective_from <= v_now)
    and (effective_to is null or effective_to >= v_now)
    and index_status = 'INDEXED';
  
  return v_result;
end;
$$;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 
-- This migration implements Phase 1 of the Evidence System:
-- 
-- ✅ Evidence items with scopes (ORG, PROJECT, TEMPLATE, CONVERSATION)
-- ✅ Source types (POLICY, RULESET, KNOWLEDGE, etc.)
-- ✅ Governance (status, version, effective dates, approvals)
-- ✅ Storage (FILE and LINK support)
-- ✅ Indexing status tracking
-- ✅ Evidence chunks for retrieval
-- ✅ Business context fields (org/project)
-- ✅ EvidenceSet storage in evaluations
-- ✅ Helper function for resolving evidence sets
--
-- Next steps (Phase 2):
--   - Implement indexing pipeline (async worker)
--   - Implement retrieval API
--   - Evidence-aware graph edges
--   - Ruleset detectors
--
-- Phase 3:
--   - Approval workflow UI
--   - Snapshotting for links
--   - System export verification
--
-- ============================================================================


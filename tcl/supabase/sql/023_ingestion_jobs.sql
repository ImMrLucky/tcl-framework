-- Ingestion Jobs & Assets Schema
-- Supports async transcription, verification, and job-based ingestion workflow

-- ============================================================================
-- INGESTION JOBS
-- ============================================================================

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  env text not null default 'sandbox' check (env in ('sandbox', 'production')),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('TRANSCRIPT_ONLY', 'AUDIO_ONLY', 'AUDIO_PLUS_TRANSCRIPT')),
  status text not null default 'UPLOADED' check (status in ('UPLOADED', 'TRANSCRIBING', 'ANALYZING', 'VERIFYING', 'COMPLETE', 'FAILED')),
  error_code text,
  error_message text,
  progress_json jsonb not null default '{"stage": null, "pct": 0}'::jsonb,
  result_json jsonb not null default '{"analysisRunId": null, "verificationReportId": null}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ingestion_jobs_org_id on public.ingestion_jobs(org_id);
create index if not exists idx_ingestion_jobs_project_id on public.ingestion_jobs(project_id);
create index if not exists idx_ingestion_jobs_status on public.ingestion_jobs(status);
create index if not exists idx_ingestion_jobs_created_by on public.ingestion_jobs(created_by_user_id);
create index if not exists idx_ingestion_jobs_created_at on public.ingestion_jobs(created_at desc);

drop trigger if exists trg_ingestion_jobs_updated_at on public.ingestion_jobs;
create trigger trg_ingestion_jobs_updated_at
before update on public.ingestion_jobs
for each row execute function public.set_updated_at();

-- ============================================================================
-- ASSETS (Files and derived outputs)
-- ============================================================================

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.ingestion_jobs(id) on delete cascade,
  type text not null check (type in ('AUDIO', 'TRANSCRIPT_UPLOADED', 'TRANSCRIPT_ASR', 'TRANSCRIPT_NORMALIZED')),
  storage_url text not null, -- local path or S3 URL
  content_hash text not null, -- sha256
  mime_type text,
  metadata_json jsonb not null default '{}'::jsonb, -- durationMs, language, segments count, etc.
  created_at timestamptz not null default now()
);

create index if not exists idx_assets_org_id on public.assets(org_id);
create index if not exists idx_assets_job_id on public.assets(job_id);
create index if not exists idx_assets_type on public.assets(type);
create index if not exists idx_assets_content_hash on public.assets(content_hash);

-- ============================================================================
-- VERIFICATION REPORTS (Audio + Transcript comparison)
-- ============================================================================

create table if not exists public.verification_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.ingestion_jobs(id) on delete cascade,
  uploaded_transcript_asset_id uuid not null references public.assets(id) on delete cascade,
  asr_transcript_asset_id uuid not null references public.assets(id) on delete cascade,
  summary_json jsonb not null default '{}'::jsonb, -- mismatch score, entity mismatches, high-risk differences, notes
  created_at timestamptz not null default now()
);

create index if not exists idx_verification_reports_org_id on public.verification_reports(org_id);
create index if not exists idx_verification_reports_job_id on public.verification_reports(job_id);

-- ============================================================================
-- UPDATE EVALUATIONS TABLE
-- ============================================================================

-- Add fields to link evaluations to ingestion jobs and assets
alter table public.evaluations
add column if not exists job_id uuid references public.ingestion_jobs(id) on delete set null,
add column if not exists transcript_asset_id uuid references public.assets(id) on delete set null,
add column if not exists verification_level text check (verification_level in ('TRANSCRIPT_ONLY', 'TRANSCRIPT_PROVIDED', 'AUDIO_VERIFIED', 'MISMATCH_FLAGGED'));

create index if not exists idx_evaluations_job_id on public.evaluations(job_id) where job_id is not null;
create index if not exists idx_evaluations_transcript_asset_id on public.evaluations(transcript_asset_id) where transcript_asset_id is not null;
create index if not exists idx_evaluations_verification_level on public.evaluations(verification_level);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
alter table public.ingestion_jobs enable row level security;
alter table public.assets enable row level security;
alter table public.verification_reports enable row level security;

-- Ingestion jobs: users can view/create jobs for their org
drop policy if exists "Users can view ingestion jobs in their org" on public.ingestion_jobs;
create policy "Users can view ingestion jobs in their org"
  on public.ingestion_jobs for select
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth_uid()
    )
  );

drop policy if exists "Users can create ingestion jobs in their org" on public.ingestion_jobs;
create policy "Users can create ingestion jobs in their org"
  on public.ingestion_jobs for insert
  with check (
    org_id in (
      select org_id from public.org_members
      where user_id = auth_uid()
    )
    and created_by_user_id = auth_uid()
  );

drop policy if exists "Users can update ingestion jobs in their org" on public.ingestion_jobs;
create policy "Users can update ingestion jobs in their org"
  on public.ingestion_jobs for update
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth_uid()
    )
  );

-- Assets: users can view/create assets for their org
drop policy if exists "Users can view assets in their org" on public.assets;
create policy "Users can view assets in their org"
  on public.assets for select
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth_uid()
    )
  );

drop policy if exists "Users can create assets in their org" on public.assets;
create policy "Users can create assets in their org"
  on public.assets for insert
  with check (
    org_id in (
      select org_id from public.org_members
      where user_id = auth_uid()
    )
  );

-- Verification reports: users can view reports for their org
drop policy if exists "Users can view verification reports in their org" on public.verification_reports;
create policy "Users can view verification reports in their org"
  on public.verification_reports for select
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth_uid()
    )
  );

drop policy if exists "Users can create verification reports in their org" on public.verification_reports;
create policy "Users can create verification reports in their org"
  on public.verification_reports for insert
  with check (
    org_id in (
      select org_id from public.org_members
      where user_id = auth_uid()
    )
  );


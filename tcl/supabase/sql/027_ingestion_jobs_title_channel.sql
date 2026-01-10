-- Add title and channel fields to ingestion_jobs
-- Also add READY status to status check constraint

-- ============================================================================
-- UPDATE INGESTION_JOBS TABLE
-- ============================================================================

-- Add title and channel fields
alter table public.ingestion_jobs
add column if not exists title text,
add column if not exists channel text,
add column if not exists last_error text;

-- Create index for title search
create index if not exists idx_ingestion_jobs_title on public.ingestion_jobs(title) where title is not null;

-- Create index for channel filtering
create index if not exists idx_ingestion_jobs_channel on public.ingestion_jobs(channel) where channel is not null;

-- Update status check constraint to include READY
alter table public.ingestion_jobs
drop constraint if exists ingestion_jobs_status_check;

alter table public.ingestion_jobs
add constraint ingestion_jobs_status_check
check (status in ('UPLOADED', 'READY', 'TRANSCRIBING', 'ANALYZING', 'VERIFYING', 'COMPLETE', 'FAILED'));


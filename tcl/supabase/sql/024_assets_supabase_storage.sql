-- Assets Supabase Storage Migration
-- Updates assets table to support Supabase Storage buckets and adds asset_id fields to ingestion_jobs

-- ============================================================================
-- UPDATE ASSETS TABLE
-- ============================================================================

-- Add new Supabase Storage fields (nullable for backward compatibility)
alter table public.assets
add column if not exists bucket text,
add column if not exists object_path text,
add column if not exists size_bytes bigint,
add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
add column if not exists uploader_user_id uuid references auth.users(id) on delete set null,
add column if not exists kind text check (kind in ('audio', 'transcript', 'evidence', 'export'));

-- Create unique index for bucket + object_path
create unique index if not exists assets_bucket_path_uidx
  on public.assets(bucket, object_path)
  where bucket is not null and object_path is not null;

-- Create index for kind
create index if not exists idx_assets_kind on public.assets(kind) where kind is not null;

-- ============================================================================
-- UPDATE INGESTION_JOBS TABLE
-- ============================================================================

-- Add asset_id fields to link jobs to uploaded assets
alter table public.ingestion_jobs
add column if not exists audio_asset_id uuid references public.assets(id) on delete set null,
add column if not exists transcript_asset_id uuid references public.assets(id) on delete set null;

-- Create indexes for asset_id lookups
create index if not exists idx_ingestion_jobs_audio_asset_id on public.ingestion_jobs(audio_asset_id) where audio_asset_id is not null;
create index if not exists idx_ingestion_jobs_transcript_asset_id on public.ingestion_jobs(transcript_asset_id) where transcript_asset_id is not null;

-- ============================================================================
-- COMMENTS
-- ============================================================================

comment on column public.assets.bucket is 'Supabase Storage bucket name (protectqa-audio, protectqa-transcripts, etc.)';
comment on column public.assets.object_path is 'Path within the bucket (org/{orgId}/conv/{conversationId}/audio/{assetId}.{ext})';
comment on column public.assets.size_bytes is 'File size in bytes';
comment on column public.assets.kind is 'Asset kind: audio, transcript, evidence, or export';
comment on column public.ingestion_jobs.audio_asset_id is 'Reference to uploaded audio asset';
comment on column public.ingestion_jobs.transcript_asset_id is 'Reference to uploaded transcript asset';


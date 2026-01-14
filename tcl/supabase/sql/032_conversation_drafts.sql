-- Conversation Drafts Migration
-- Adds support for draft conversations with transcription status tracking

-- ============================================================================
-- ADD DRAFT STATUS COLUMNS TO CONVERSATIONS
-- ============================================================================

-- Add draft_status column (nullable, only set for drafts)
alter table public.conversations
add column if not exists draft_status text check (draft_status in (
  'DRAFT_AUDIO_UPLOADED',
  'TRANSCRIPTION_QUEUED',
  'TRANSCRIBING',
  'TRANSCRIPT_READY',
  'TRANSCRIPTION_FAILED',
  'EVALUATED'
));

-- Add audio_asset_id (references assets table)
alter table public.conversations
add column if not exists audio_asset_id uuid references public.assets(id) on delete set null;

-- Add transcript_asset_id (set when transcription completes)
alter table public.conversations
add column if not exists transcript_asset_id uuid references public.assets(id) on delete set null;

-- Add transcription_error (stores error message if transcription fails)
alter table public.conversations
add column if not exists transcription_error text;

-- Add evaluation_id (set after evaluation completes)
alter table public.conversations
add column if not exists evaluation_id uuid references public.evaluations(id) on delete set null;

-- Add updated_at if it doesn't exist
alter table public.conversations
add column if not exists updated_at timestamptz not null default now();

-- Make content nullable for drafts (audio-only drafts don't have content yet)
-- This was already done in 005_integrations_schema.sql, but ensure it's nullable
alter table public.conversations
alter column content drop not null;

-- ============================================================================
-- INDEXES
-- ============================================================================

create index if not exists idx_conversations_draft_status 
on public.conversations(draft_status) 
where draft_status is not null;

create index if not exists idx_conversations_audio_asset_id 
on public.conversations(audio_asset_id) 
where audio_asset_id is not null;

create index if not exists idx_conversations_evaluation_id 
on public.conversations(evaluation_id) 
where evaluation_id is not null;

-- ============================================================================
-- TRIGGER FOR UPDATED_AT
-- ============================================================================

-- Create trigger function if it doesn't exist
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Create trigger for updated_at
drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

comment on column public.conversations.draft_status is 
'Status for draft conversations: DRAFT_AUDIO_UPLOADED, TRANSCRIPTION_QUEUED, TRANSCRIBING, TRANSCRIPT_READY, TRANSCRIPTION_FAILED, or EVALUATED';

comment on column public.conversations.audio_asset_id is 
'Reference to assets table for audio file (for audio-only drafts)';

comment on column public.conversations.transcript_asset_id is 
'Reference to assets table for transcript file (set after transcription completes)';

comment on column public.conversations.transcription_error is 
'Error message if transcription fails';

comment on column public.conversations.evaluation_id is 
'Reference to evaluations table (set after evaluation completes)';


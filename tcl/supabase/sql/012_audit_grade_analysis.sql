-- Audit-Grade Analysis: Add evaluation_id to conversation_artifacts
-- This allows exports and run-specific artifacts to link to specific evaluations for audit traceability

ALTER TABLE public.conversation_artifacts
ADD COLUMN IF NOT EXISTS evaluation_id uuid NULL;

-- Add foreign key constraint
ALTER TABLE public.conversation_artifacts
DROP CONSTRAINT IF EXISTS conversation_artifacts_evaluation_id_fkey;

ALTER TABLE public.conversation_artifacts
ADD CONSTRAINT conversation_artifacts_evaluation_id_fkey
FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE SET NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_conversation_artifacts_evaluation_id 
ON public.conversation_artifacts(evaluation_id) 
WHERE evaluation_id IS NOT NULL;

-- Optional: Expand artifact_type enum to include export types
-- Uncomment if you want cleaner filtering for exports
-- ALTER TYPE artifact_type_enum ADD VALUE IF NOT EXISTS 'export_pdf';
-- ALTER TYPE artifact_type_enum ADD VALUE IF NOT EXISTS 'export_csv';
-- ALTER TYPE artifact_type_enum ADD VALUE IF NOT EXISTS 'export_json';
-- ALTER TYPE artifact_type_enum ADD VALUE IF NOT EXISTS 'normalized_transcript';

-- Note: If enum expansion is not possible, use 'attachment' for exports
-- and set content_type = 'application/pdf' / 'text/csv' / 'application/json'
-- and content_json.export = { type, scope, evaluation_id, checksum }


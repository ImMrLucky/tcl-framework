-- Add new profile fields for onboarding
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS company_role text,
ADD COLUMN IF NOT EXISTS company_industry text,
ADD COLUMN IF NOT EXISTS call_operation text,
ADD COLUMN IF NOT EXISTS primary_use_case text;

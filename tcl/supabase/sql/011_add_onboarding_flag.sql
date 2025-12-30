-- Add onboarding_completed flag to profiles table
-- This tracks whether the user has seen/dismissed the onboarding modal

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_completed 
ON public.profiles(onboarding_completed) 
WHERE onboarding_completed = false;

-- Update existing profiles: if they have onboarding data, mark as completed
UPDATE public.profiles
SET onboarding_completed = true
WHERE (company_industry IS NOT NULL AND company_industry != '')
   OR (call_operation IS NOT NULL AND call_operation != '')
   OR (primary_use_case IS NOT NULL AND primary_use_case != '');


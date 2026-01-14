-- ============================================================================
-- COMPLETE DATABASE CLEANUP SCRIPT
-- ============================================================================
-- 
-- This script removes ALL data from the database while preserving:
--   - User accounts (auth.users)
--   - User profiles (public.profiles) - optional, see below
--   - Organizations (public.organizations) - optional, see below
--   - Organization memberships (public.org_members) - optional, see below
--
-- WARNING: This will delete ALL application data including:
--   - All evaluations and issues
--   - All conversations
--   - All ingestion jobs and assets
--   - All policies, scoring profiles, etc.
--
-- Usage:
--   1. Run this script in Supabase SQL Editor or via psql
--   2. Run the storage cleanup script (see below)
--
-- To run via Supabase CLI:
--   supabase db execute -f supabase/sql/999_cleanup_all_data.sql
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Delete data in order to respect foreign key constraints
-- ============================================================================

-- 1. Delete issue workflow data
DELETE FROM public.issue_actions_log;
DELETE FROM public.issue_comments;
DELETE FROM public.issue_workflow;

-- 2. Delete policy library data
DELETE FROM public.issue_policy_links;
DELETE FROM public.policy_sources;
DELETE FROM public.policies;

-- 3. Delete scoring profiles
DELETE FROM public.scoring_profiles;

-- 4. Delete ingestion jobs (references assets)
DELETE FROM public.ingestion_jobs;

-- 5. Delete assets (references conversations, users, etc.)
DELETE FROM public.assets;

-- 6. Delete conversation artifacts (must be before conversations)
DELETE FROM public.conversation_artifacts;

-- 7. Delete evaluations (contains issue data)
DELETE FROM public.evaluations;

-- 8. Delete conversations
DELETE FROM public.conversations;

-- 9. Delete validations
DELETE FROM public.validations;

-- 10. Delete evidence artifacts (must be before evidence_sources)
DELETE FROM public.evidence_artifacts;

-- 11. Delete evidence sources
DELETE FROM public.evidence_sources;

-- 12. Delete sources (evidence)
DELETE FROM public.sources;

-- 13. Delete integration/webhook data (order matters due to foreign keys)
DELETE FROM public.delivery_attempts;
DELETE FROM public.realtime_sessions;
DELETE FROM public.webhook_tokens;
DELETE FROM public.webhook_endpoints;
DELETE FROM public.idempotency_keys;
DELETE FROM public.integration_connections;
DELETE FROM public.integrations;

-- 14. Delete audit logs
DELETE FROM public.audit_log;

-- 15. Delete usage tracking (must be before projects)
DELETE FROM public.usage_daily;

-- 16. Delete project environments (must be before projects)
DELETE FROM public.project_envs;

-- 17. Delete projects
DELETE FROM public.projects;

-- 18. Delete API keys
DELETE FROM public.api_keys;

-- ============================================================================
-- STEP 2: Optional - Clear user/organization data
-- ============================================================================
-- Uncomment the following sections if you want a COMPLETE reset:

-- Option A: Keep organizations but clear memberships (for testing with same orgs)
-- DELETE FROM public.org_members;

-- Option B: Delete everything including organizations (complete reset)
-- DELETE FROM public.org_members;
-- DELETE FROM public.organizations;

-- Option C: Also reset user profiles (keeps auth.users but clears profile data)
-- DELETE FROM public.profiles;

-- ============================================================================
-- STEP 3: Reset sequences (optional - for fresh IDs)
-- ============================================================================
-- Uncomment if you want to reset auto-incrementing IDs:

-- ALTER SEQUENCE IF EXISTS public.issue_comments_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.issue_actions_log_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.policies_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.policy_sources_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.issue_policy_links_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.scoring_profiles_id_seq RESTART WITH 1;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after cleanup to verify:

-- SELECT COUNT(*) as evaluations FROM public.evaluations;
-- SELECT COUNT(*) as conversations FROM public.conversations;
-- SELECT COUNT(*) as assets FROM public.assets;
-- SELECT COUNT(*) as ingestion_jobs FROM public.ingestion_jobs;
-- SELECT COUNT(*) as issues_workflow FROM public.issue_workflow;
-- SELECT COUNT(*) as policies FROM public.policies;


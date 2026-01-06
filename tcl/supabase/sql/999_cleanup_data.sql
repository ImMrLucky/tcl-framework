-- Database Cleanup Script
-- Removes all data while preserving user accounts and organizational structure
-- 
-- WARNING: This will delete ALL data except:
--   - User accounts (auth.users)
--   - User profiles (public.profiles)
--   - Organizations (public.organizations)
--   - Organization memberships (public.org_members)
--
-- Usage: Run this script in your Supabase SQL editor or via psql
-- 
-- To run via Supabase CLI:
--   supabase db execute -f supabase/sql/999_cleanup_data.sql

BEGIN;

-- Delete in order to respect foreign key constraints

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

-- 4. Delete conversation artifacts (must be before conversations)
DELETE FROM public.conversation_artifacts;

-- 5. Delete evaluations (contains issue data)
DELETE FROM public.evaluations;

-- 6. Delete conversations
DELETE FROM public.conversations;

-- 7. Delete validations
DELETE FROM public.validations;

-- 8. Delete evidence artifacts (must be before evidence_sources)
DELETE FROM public.evidence_artifacts;

-- 9. Delete evidence sources
DELETE FROM public.evidence_sources;

-- 10. Delete sources (evidence)
DELETE FROM public.sources;

-- 11. Delete integration/webhook data (order matters due to foreign keys)
DELETE FROM public.delivery_attempts;
DELETE FROM public.realtime_sessions;
DELETE FROM public.webhook_tokens;
DELETE FROM public.idempotency_keys;
DELETE FROM public.integrations;

-- 12. Delete audit logs
DELETE FROM public.audit_log;

-- 13. Delete usage tracking (must be before projects)
DELETE FROM public.usage_daily;

-- 14. Delete project environments (must be before projects)
DELETE FROM public.project_envs;

-- 15. Delete projects (organizational data - uncomment if you want to keep projects)
DELETE FROM public.projects;

-- 16. Delete API keys (optional - uncomment if you want to keep them)
-- DELETE FROM public.api_keys;

-- Note: The following tables are PRESERVED:
--   - auth.users (Supabase auth - user accounts)
--   - public.profiles (user profile data)
--   - public.organizations (organization structure)
--   - public.org_members (user-organization relationships)

COMMIT;

-- Optional: Reset sequences if you want fresh IDs
-- Uncomment the following if you want to reset auto-incrementing IDs:
-- 
-- ALTER SEQUENCE IF EXISTS public.issue_comments_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.issue_actions_log_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.policies_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.policy_sources_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.issue_policy_links_id_seq RESTART WITH 1;
-- ALTER SEQUENCE IF EXISTS public.scoring_profiles_id_seq RESTART WITH 1;


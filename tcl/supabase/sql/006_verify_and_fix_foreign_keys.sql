-- Verify and fix foreign key constraints
-- Run this to check if foreign keys are deferrable and fix them if not

-- Check current state of foreign keys
SELECT 
  conname as constraint_name,
  condeferrable as is_deferrable,
  condeferred as is_deferred,
  contype as constraint_type
FROM pg_constraint 
WHERE conname IN ('profiles_id_fkey', 'org_members_user_id_fkey')
ORDER BY conname;

-- If the above shows is_deferrable = false, run the fixes below:

-- Fix profiles foreign key
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_id_fkey' 
    AND conrelid = 'public.profiles'::regclass
    AND condeferrable = false
  ) THEN
    ALTER TABLE public.profiles
    DROP CONSTRAINT profiles_id_fkey;
    
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;
    
    RAISE NOTICE 'Fixed profiles_id_fkey - now deferrable';
  ELSE
    RAISE NOTICE 'profiles_id_fkey is already deferrable or does not exist';
  END IF;
END $$;

-- Fix org_members foreign key
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'org_members_user_id_fkey' 
    AND conrelid = 'public.org_members'::regclass
    AND condeferrable = false
  ) THEN
    ALTER TABLE public.org_members
    DROP CONSTRAINT org_members_user_id_fkey;
    
    ALTER TABLE public.org_members
    ADD CONSTRAINT org_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;
    
    RAISE NOTICE 'Fixed org_members_user_id_fkey - now deferrable';
  ELSE
    RAISE NOTICE 'org_members_user_id_fkey is already deferrable or does not exist';
  END IF;
END $$;

-- Verify the fix
SELECT 
  conname as constraint_name,
  condeferrable as is_deferrable,
  condeferred as is_deferred
FROM pg_constraint 
WHERE conname IN ('profiles_id_fkey', 'org_members_user_id_fkey')
ORDER BY conname;


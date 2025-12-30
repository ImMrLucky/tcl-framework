-- Complete Profile Creation Fix
-- This combines the trigger, deferrable foreign keys, and RPC function
-- Run this ONCE to fix all profile creation issues

-- 1. Create trigger function and trigger (auto-creates profiles on signup)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (
    new.id,
    new.email
  )
  ON CONFLICT (id) DO UPDATE
  SET email = new.email,
      updated_at = now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Make foreign keys deferrable (handles timing issues)
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_id_fkey
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.org_members
DROP CONSTRAINT IF EXISTS org_members_user_id_fkey;

ALTER TABLE public.org_members
ADD CONSTRAINT org_members_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
DEFERRABLE INITIALLY DEFERRED;

-- 3. Create RPC function for reliable profile creation
CREATE OR REPLACE FUNCTION public.ensure_user_profile(
  p_user_id uuid,
  p_email text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_exists boolean;
  v_profile_exists boolean;
BEGIN
  -- Check if user exists in auth.users
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id) INTO v_user_exists;
  
  IF NOT v_user_exists THEN
    RAISE EXCEPTION 'User % does not exist in auth.users', p_user_id;
  END IF;
  
  -- Check if profile already exists
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_user_id) INTO v_profile_exists;
  
  IF v_profile_exists THEN
    -- Update email if provided and different
    IF p_email IS NOT NULL THEN
      UPDATE public.profiles
      SET email = p_email,
          updated_at = now()
      WHERE id = p_user_id;
    END IF;
    RETURN true;
  END IF;
  
  -- Create profile
  -- SECURITY DEFINER bypasses RLS, so this will work
  INSERT INTO public.profiles (id, email, created_at, updated_at)
  VALUES (
    p_user_id,
    p_email,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = COALESCE(EXCLUDED.email, profiles.email),
      updated_at = now();
  
  RETURN true;
EXCEPTION
  WHEN foreign_key_violation THEN
    -- User might not be fully committed yet, but trigger should handle it
    -- Check if trigger created it
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_user_id) INTO v_profile_exists;
    IF v_profile_exists THEN
      RETURN true;
    END IF;
    RAISE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(uuid, text) TO service_role;

-- 4. Create profiles for any existing auth users who don't have one
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT 
  id, 
  email,
  created_at,
  now()
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- Verify everything is set up
DO $$
BEGIN
  RAISE NOTICE 'Profile creation setup complete:';
  RAISE NOTICE '  - Trigger: %', (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'on_auth_user_created');
  RAISE NOTICE '  - RPC Function: %', (SELECT COUNT(*) FROM pg_proc WHERE proname = 'ensure_user_profile');
  RAISE NOTICE '  - Deferrable FK (profiles): %', (SELECT condeferrable FROM pg_constraint WHERE conname = 'profiles_id_fkey');
  RAISE NOTICE '  - Deferrable FK (org_members): %', (SELECT condeferrable FROM pg_constraint WHERE conname = 'org_members_user_id_fkey');
END $$;


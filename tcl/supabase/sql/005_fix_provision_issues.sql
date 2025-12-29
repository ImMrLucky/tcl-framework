-- Fix provision issues by making foreign keys more lenient
-- and ensuring the trigger works correctly

-- First, create the trigger function and trigger if they don't exist
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

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Make foreign keys deferrable to handle timing issues
-- This allows the constraint to be checked at the end of the transaction
-- instead of immediately

-- Drop and recreate profiles foreign key as deferrable
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_id_fkey
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
DEFERRABLE INITIALLY DEFERRED;

-- Drop and recreate org_members foreign key as deferrable
ALTER TABLE public.org_members
DROP CONSTRAINT IF EXISTS org_members_user_id_fkey;

ALTER TABLE public.org_members
ADD CONSTRAINT org_members_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
DEFERRABLE INITIALLY DEFERRED;

-- Create profiles for any existing auth users who don't have one
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT 
  id, 
  email,
  created_at,
  now()
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;


-- Create a database function to ensure profile exists
-- This runs in the database context, so it can handle timing issues better
-- and can use DEFERRABLE constraints properly

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
  -- Since we're in a function with SECURITY DEFINER, we can insert directly
  -- The foreign key constraint will be checked, but since we verified the user exists,
  -- this should work. If it doesn't, the trigger will handle it.
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

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(uuid, text) TO service_role;


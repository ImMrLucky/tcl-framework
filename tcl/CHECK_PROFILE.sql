-- Check if profile exists for a user
-- Replace 'USER_ID_HERE' with the actual user ID

-- 1. Check if user exists in auth.users
SELECT id, email, created_at 
FROM auth.users 
WHERE id = 'USER_ID_HERE';

-- 2. Check if profile exists
SELECT * 
FROM public.profiles 
WHERE id = 'USER_ID_HERE';

-- 3. Check full user data (all tables)
SELECT 
  u.id as user_id,
  u.email as auth_email,
  p.id as profile_id,
  p.email as profile_email,
  p.company_role,
  p.company_industry,
  om.org_id,
  om.role as org_role,
  o.name as org_name,
  pr.id as project_id,
  pr.name as project_name,
  pe.env as project_env
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
LEFT JOIN public.org_members om ON u.id = om.user_id
LEFT JOIN public.organizations o ON om.org_id = o.id
LEFT JOIN public.projects pr ON o.id = pr.org_id
LEFT JOIN public.project_envs pe ON pr.id = pe.project_id
WHERE u.id = 'USER_ID_HERE';

-- 4. Check if trigger exists
SELECT * 
FROM pg_trigger 
WHERE tgname = 'on_auth_user_created';

-- 5. Create profile for this user (if missing)
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT 
  id, 
  email,
  created_at,
  now()
FROM auth.users
WHERE id = 'USER_ID_HERE'
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    updated_at = now();


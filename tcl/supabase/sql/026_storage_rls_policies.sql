-- Storage RLS Policies for Supabase Storage Buckets
-- 
-- This migration creates RLS policies to allow authenticated users to:
-- 1. Upload files to their organization's folders (INSERT)
-- 2. Read files from their organization's folders (SELECT)
-- 3. Update/overwrite files in their organization's folders (UPDATE)
--
-- Buckets: protectqa-audio, protectqa-transcripts, protectqa-evidence, protectqa-exports
--
-- Path structure: org/{orgId}/conv/{conversationId}/{kind}/{assetId}.{ext}

-- ============================================================================
-- HELPER FUNCTION: Check if user belongs to org (by folder path)
-- ============================================================================

-- Function to extract org_id from object path and verify user membership
-- Created in public schema to avoid storage schema restrictions
create or replace function public.check_storage_org_access(object_name text)
returns boolean
language plpgsql
security definer
stable
as $$
declare
  path_parts text[];
  org_id_from_path uuid;
begin
  -- Extract path parts: org/{orgId}/conv/...
  path_parts := string_to_array(object_name, '/');
  
  -- Check if path starts with 'org'
  if array_length(path_parts, 1) < 2 or path_parts[1] != 'org' then
    return false;
  end if;
  
  -- Extract org_id from path (second element)
  begin
    org_id_from_path := path_parts[2]::uuid;
  exception when others then
    return false;
  end;
  
  -- Check if user is a member of this org
  return exists (
    select 1
    from public.org_members
    where org_id = org_id_from_path
      and user_id = auth.uid()
  );
end;
$$;

-- ============================================================================
-- POLICY: Allow authenticated users to INSERT (upload) to their org folders
-- ============================================================================

-- protectqa-audio bucket
drop policy if exists "Allow authenticated uploads to protectqa-audio" on storage.objects;
create policy "Allow authenticated uploads to protectqa-audio"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'protectqa-audio'
  and public.check_storage_org_access(name)
);

-- protectqa-transcripts bucket
drop policy if exists "Allow authenticated uploads to protectqa-transcripts" on storage.objects;
create policy "Allow authenticated uploads to protectqa-transcripts"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'protectqa-transcripts'
  and public.check_storage_org_access(name)
);

-- protectqa-evidence bucket
drop policy if exists "Allow authenticated uploads to protectqa-evidence" on storage.objects;
create policy "Allow authenticated uploads to protectqa-evidence"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'protectqa-evidence'
  and public.check_storage_org_access(name)
);

-- protectqa-exports bucket
drop policy if exists "Allow authenticated uploads to protectqa-exports" on storage.objects;
create policy "Allow authenticated uploads to protectqa-exports"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'protectqa-exports'
  and public.check_storage_org_access(name)
);

-- ============================================================================
-- POLICY: Allow authenticated users to SELECT (read) from their org folders
-- ============================================================================

-- protectqa-audio bucket
drop policy if exists "Allow authenticated reads from protectqa-audio" on storage.objects;
create policy "Allow authenticated reads from protectqa-audio"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'protectqa-audio'
  and public.check_storage_org_access(name)
);

-- protectqa-transcripts bucket
drop policy if exists "Allow authenticated reads from protectqa-transcripts" on storage.objects;
create policy "Allow authenticated reads from protectqa-transcripts"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'protectqa-transcripts'
  and public.check_storage_org_access(name)
);

-- protectqa-evidence bucket
drop policy if exists "Allow authenticated reads from protectqa-evidence" on storage.objects;
create policy "Allow authenticated reads from protectqa-evidence"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'protectqa-evidence'
  and public.check_storage_org_access(name)
);

-- protectqa-exports bucket
drop policy if exists "Allow authenticated reads from protectqa-exports" on storage.objects;
create policy "Allow authenticated reads from protectqa-exports"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'protectqa-exports'
  and public.check_storage_org_access(name)
);

-- ============================================================================
-- POLICY: Allow authenticated users to UPDATE (overwrite) files in their org folders
-- ============================================================================

-- protectqa-audio bucket
drop policy if exists "Allow authenticated updates to protectqa-audio" on storage.objects;
create policy "Allow authenticated updates to protectqa-audio"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'protectqa-audio'
  and public.check_storage_org_access(name)
);

-- protectqa-transcripts bucket
drop policy if exists "Allow authenticated updates to protectqa-transcripts" on storage.objects;
create policy "Allow authenticated updates to protectqa-transcripts"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'protectqa-transcripts'
  and public.check_storage_org_access(name)
);

-- protectqa-evidence bucket
drop policy if exists "Allow authenticated updates to protectqa-evidence" on storage.objects;
create policy "Allow authenticated updates to protectqa-evidence"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'protectqa-evidence'
  and public.check_storage_org_access(name)
);

-- protectqa-exports bucket
drop policy if exists "Allow authenticated updates to protectqa-exports" on storage.objects;
create policy "Allow authenticated updates to protectqa-exports"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'protectqa-exports'
  and public.check_storage_org_access(name)
);

-- ============================================================================
-- NOTES
-- ============================================================================
--
-- After running this migration:
-- 1. Verify policies exist: SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';
-- 2. Test with a small file upload from the frontend
-- 3. Test direct URL access (should work for authenticated users in the same org)
-- 4. If issues persist, check that:
--    - Buckets exist and are private (not public)
--    - Users have valid org_members entries
--    - Object paths follow the pattern: org/{orgId}/conv/...


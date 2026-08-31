-- 0034_message_attachments_storage.sql
--
-- Photos in a team channel are photos of other people's children, so the
-- bucket is private and every read is authorised against channel membership.
-- A public bucket would mean one leaked URL is permanently public, with no
-- way to revoke it and no record of who fetched it.
--
-- The path carries the authorisation: {academy_id}/{channel_id}/{uploader}/{file}.
-- The policies read the channel and the uploader out of the path and ask the
-- same questions the messages policies ask.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false,
  10485760,  -- 10 MB. Phone photos are 3-5 MB and the client downsizes first.
  array['image/jpeg','image/png','image/webp','image/heic','image/gif','application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

-- Read: anyone in that channel. Membership, not posting rights - a parent in
-- a broadcast channel must still see the photos.
create policy "attachments readable by channel members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and app_private.is_channel_member(((storage.foldername(name))[2])::uuid)
  );

-- Write: only someone who could post a message there. Otherwise a parent in a
-- hosts_only channel could not post text but could upload a photo, which is
-- the same thing with extra steps.
create policy "attachments writable by those who can post"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and app_private.can_post_in_channel(((storage.foldername(name))[2])::uuid, null)
    and (storage.foldername(name))[3] = auth.uid()::text
  );

create policy "attachments removable by owner or host"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      (storage.foldername(name))[3] = auth.uid()::text
      or app_private.is_channel_host(((storage.foldername(name))[2])::uuid)
    )
  );

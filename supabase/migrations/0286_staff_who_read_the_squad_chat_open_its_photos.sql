-- 0286 — staff who may read a squad's chat may open its photos (found by the
-- simulation's files scenario, 17 Nov 2026).
--
-- 0278 let a club's owners and admins read a squad chat without being a
-- member of it; the attachments bucket's read rule still asked for a member
-- row, so the President saw the messages and a pulsing grey box where every
-- photo should be. The same helper decides both now.
drop policy if exists "attachments readable by channel members" on storage.objects;
create policy "attachments readable by channel members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (app_private.is_channel_member(((storage.foldername(name))[2])::uuid)
         or app_private.staff_reads_channel(((storage.foldername(name))[2])::uuid))
    and (
      (storage.foldername(name))[4] is distinct from 'staff'
      or app_private.sees_staff_notices(((storage.foldername(name))[2])::uuid)
    )
  );

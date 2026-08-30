-- test-rls.sql — proves tenant isolation and the permission model.
--
-- Run against a seeded dev database:
--   psql "$SUPABASE_DB_URL" -f scripts/test-rls.sql
--
-- It impersonates real users by setting request.jwt.claims and switching to
-- the `authenticated` role — exactly what PostgREST does for a logged-in
-- request. Table owners bypass RLS, so without that role switch this test
-- would prove nothing at all.
--
-- Every check writes a row. Any FAIL in the output is a real defect.

create temp table if not exists rls_results(n int, check_name text, result text);
grant insert, select on rls_results to authenticated;
truncate rls_results;

do $$
declare
  ACAD_A   constant uuid := '00000000-0000-0000-0000-0000000a0001'; -- NRIFA
  ACAD_B   constant uuid := '00000000-0000-0000-0000-0000000a0002'; -- Ravens FC
  COACH    constant uuid := '00000000-0000-0000-0000-0000000000a1'; -- owner
  MARCUS   constant uuid := '00000000-0000-0000-0000-0000000000a2'; -- coach
  PARENT   constant uuid := '00000000-0000-0000-0000-0000000000b1'; -- U8 parent
  OUTSIDER constant uuid := '00000000-0000-0000-0000-0000000000c2'; -- other tenant
  ANNO     constant uuid := '00000000-0000-0000-0000-00000000c001';
  v_u8 uuid; v_rv uuid; n int; b bool; foreign_rows int;
begin
  select id into v_u8 from public.channels where team_id = '00000000-0000-0000-0000-0000000d0008' and type='team';
  select id into v_rv from public.channels where team_id = '00000000-0000-0000-0000-0000000d0099' and type='team';

  -- ======================= tenant isolation, reads =======================
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.academies where id = ACAD_B;
  insert into rls_results values (1,'academy B invisible', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  select count(*) into n from public.messages where academy_id = ACAD_B;
  insert into rls_results values (2,'academy B messages unreadable', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  select count(*) into n from public.channels where academy_id = ACAD_B;
  insert into rls_results values (3,'academy B channels invisible', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  select count(*) into n from public.players where academy_id = ACAD_B;
  insert into rls_results values (4,'academy B players invisible', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  select count(*) into n from public.events where academy_id = ACAD_B;
  insert into rls_results values (5,'academy B events invisible', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  select count(*) into n from public.messages where channel_id = v_u8;
  insert into rls_results values (6,'own team channel readable', case when n>=5 then 'PASS ('||n||')' else 'FAIL ('||n||')' end);

  -- ======================= asymmetric visibility =======================
  select count(*) into n from public.event_rsvps where profile_id <> PARENT;
  insert into rls_results values (7,'parent sees no one else''s RSVP', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  -- Count-free assertion: whatever is visible must belong to me.
  select count(*) into foreign_rows from public.message_reactions where profile_id <> PARENT;
  insert into rls_results values (8,'parent sees no one else''s reaction identity',
    case when foreign_rows=0 then 'PASS' else 'FAIL ('||foreign_rows||' foreign rows)' end);

  select reaction_count into n from public.reaction_counts(array[ANNO]) where emoji='👍';
  insert into rls_results values (9,'reaction counts are complete', case when n=3 then 'PASS (3)' else 'FAIL ('||coalesce(n::text,'null')||')' end);

  b:=false; begin perform * from public.get_reaction_voters(ANNO,'👍'); exception when others then b:=true; end;
  insert into rls_results values (10,'parent denied voter names', case when b then 'PASS' else 'FAIL' end);

  select count(*) into n from public.member_directory(ACAD_A) where role='parent' and phone is not null;
  insert into rls_results values (11,'parent phone numbers withheld', case when n=0 then 'PASS' else 'FAIL ('||n||' exposed)' end);

  b:=false;
  begin execute 'select phone from public.profiles where id='''||MARCUS||'''::uuid';
  exception when others then b:=true; end;
  insert into rls_results values (12,'profiles.phone unreachable directly', case when b then 'PASS' else 'FAIL' end);

  -- ======================= tenant isolation, writes =======================
  b:=false;
  begin
    insert into public.messages (academy_id, channel_id, sender_id, body)
    values (ACAD_B, v_rv, PARENT, 'cross-tenant write');
  exception when others then b:=true; end;
  insert into rls_results values (13,'cross-tenant write refused', case when b then 'PASS' else 'FAIL' end);

  b:=false;
  begin
    insert into public.messages (academy_id, channel_id, sender_id, body, is_announcement)
    values (ACAD_A, v_u8, PARENT, 'fake', true);
  exception when others then b:=true; end;
  insert into rls_results values (14,'parent cannot post announcement', case when b then 'PASS' else 'FAIL' end);

  b:=false;
  begin
    insert into public.channel_members (academy_id, channel_id, profile_id) values (ACAD_A, v_u8, MARCUS);
  exception when others then b:=true; end;
  insert into rls_results values (15,'parent cannot add channel members', case when b then 'PASS' else 'FAIL' end);

  execute 'reset role';

  -- ======================= posting modes =======================
  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.channels set posting_mode='hosts_only' where id=v_u8;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  b:=false;
  begin insert into public.messages (academy_id, channel_id, sender_id, body)
        values (ACAD_A, v_u8, PARENT, 'blocked by hosts_only');
  exception when others then b:=true; end;
  insert into rls_results values (16,'hosts_only blocks parent posts', case when b then 'PASS' else 'FAIL' end);

  b:=true;
  begin insert into public.message_reactions (academy_id, message_id, profile_id, emoji)
        values (ACAD_A, ANNO, PARENT, '🎉');
  exception when others then b:=false; end;
  insert into rls_results values (17,'reactions still work in hosts_only', case when b then 'PASS' else 'FAIL' end);

  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.channels set posting_mode='replies_only' where id=v_u8;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  b:=false;
  begin insert into public.messages (academy_id, channel_id, sender_id, body)
        values (ACAD_A, v_u8, PARENT, 'new thread');
  exception when others then b:=true; end;
  insert into rls_results values (18,'replies_only blocks new threads', case when b then 'PASS' else 'FAIL' end);

  b:=true;
  begin insert into public.messages (academy_id, channel_id, sender_id, body, reply_to_id)
        values (ACAD_A, v_u8, PARENT, 'a reply', ANNO);
  exception when others then b:=false; end;
  insert into rls_results values (19,'replies_only allows replies', case when b then 'PASS' else 'FAIL' end);

  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.channels set posting_mode='open' where id=v_u8;
  execute 'reset role';

  -- ======================= delegated invites =======================
  perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  b:=false;
  begin insert into public.invites (academy_id, phone, role, invited_by)
        values (ACAD_A, '+61400009001', 'coach', MARCUS);
  exception when others then b:=true; end;
  insert into rls_results values (20,'coach cannot invite a coach', case when b then 'PASS' else 'FAIL' end);

  b:=true;
  begin insert into public.invites (academy_id, phone, role, invited_by)
        values (ACAD_A, '+61400009002', 'parent', MARCUS);
  exception when others then b:=false; end;
  insert into rls_results values (21,'coach can invite a parent', case when b then 'PASS' else 'FAIL' end);

  execute 'reset role';

  -- ======================= the coach's own view =======================
  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.event_rsvps where event_id='00000000-0000-0000-0000-0000000f0003';
  insert into rls_results values (22,'coach sees the full register', case when n=5 then 'PASS (5)' else 'FAIL ('||n||')' end);

  select count(*) into n from public.messages where academy_id = ACAD_B;
  insert into rls_results values (23,'even an owner cannot cross tenants', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  execute 'reset role';

  -- Leave the database as we found it, so the suite can be run repeatedly.
  -- Without this the pending-invite unique index makes check 21 fail on a
  -- second run, which would look like a policy regression and isn't one.
  delete from public.invites where phone in ('+61400009001', '+61400009002');
  delete from public.messages where body in ('a reply', 'blocked by hosts_only', 'new thread');
  delete from public.message_reactions where emoji = '🎉';
end $$;

select * from rls_results order by n;
select case when exists (select 1 from rls_results where result like 'FAIL%')
            then 'SOME CHECKS FAILED' else 'ALL CHECKS PASSED' end as verdict;

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
  v_ev uuid; v_ev_total int; v_msg uuid;
begin
  select id into v_u8 from public.channels where team_id = '00000000-0000-0000-0000-0000000d0008' and type='team';
  select id into v_rv from public.channels where team_id = '00000000-0000-0000-0000-0000000d0099' and type='team';

  -- Check 22 needs a fixture that HAS a register, and it used to name one by
  -- id. That id was a seeded event, the event was deleted at some point in a
  -- demo, and the check then failed reporting 0 of an expected 5 — which
  -- reads exactly like a coach losing sight of their own team sheet. A
  -- policy test must fail for policy reasons only.
  --
  -- So the fixture is chosen, and the truth is read HERE, before any role
  -- switch, where RLS is bypassed and the count is the real one.
  select r.event_id, count(*) into v_ev, v_ev_total
    from public.event_rsvps r
    join public.events e on e.id = r.event_id
   where e.academy_id = ACAD_A
     and e.team_id = '00000000-0000-0000-0000-0000000d0008'
   group by r.event_id
   order by count(*) desc, r.event_id
   limit 1;

  select id into v_msg from public.messages
   where channel_id = v_u8 and status = 'published'
   order by created_at limit 1;

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

  -- No fixture with a register at all is a FAIL, not a pass: a check that
  -- quietly stops checking is worse than one that breaks loudly.
  if v_ev is null then
    insert into rls_results values (22,'coach sees the full register',
      'FAIL (no U8 fixture has a register — reseed)');
  else
    select count(*) into n from public.event_rsvps where event_id = v_ev;
    insert into rls_results values (22,'coach sees the full register',
      case when n = v_ev_total then 'PASS ('||n||' of '||v_ev_total||')'
           else 'FAIL ('||n||' of '||v_ev_total||')' end);
  end if;

  select count(*) into n from public.messages where academy_id = ACAD_B;
  insert into rls_results values (23,'even an owner cannot cross tenants', case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  execute 'reset role';

  -- ================== safeguarding reports (0108) ==================
  -- A report is the one record in the product that is deliberately readable
  -- by almost nobody: the person who made it, so they know it arrived, and
  -- the appointed officer. Not a coach, and not an owner who has not
  -- appointed themselves — a club where the person complained about can read
  -- the complaint has no reporting channel at all.
  insert into public.message_reports (academy_id, channel_id, message_id, reported_by, reason, note)
  values (ACAD_A, v_u8, v_msg, PARENT, 'other', 'rls probe');

  perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.message_reports where note = 'rls probe';
  insert into rls_results values (24,'a coach cannot read a safeguarding report',
    case when n=0 then 'PASS' else 'FAIL ('||n||' visible)' end);

  -- Insert is `with check (false)` for everyone: reports are written by the
  -- RPC, which takes the channel and academy from the MESSAGE rather than
  -- from the caller, so one cannot be filed against another academy's.
  -- Literal values, not an insert..select. A select that returns no rows
  -- inserts nothing and raises nothing, so the first version of this check
  -- passed on a coach who simply could not read the message — it was
  -- measuring its own setup, not the policy.
  b := false;
  begin
    insert into public.message_reports (academy_id, channel_id, message_id, reported_by, reason, note)
    values (ACAD_A, v_u8, v_msg, MARCUS, 'other', 'direct insert');
  exception when others then b := true;
  end;
  insert into rls_results values (25,'reports cannot be inserted directly',
    case when b then 'PASS' else 'FAIL' end);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.message_reports where note = 'rls probe';
  insert into rls_results values (26,'the person who reported can see their own report',
    case when n=1 then 'PASS' else 'FAIL ('||n||')' end);

  -- A record a club can delete is not a record.
  delete from public.message_reports where note = 'rls probe';
  select count(*) into n from public.message_reports where note = 'rls probe';
  insert into rls_results values (27,'nobody can delete a report',
    case when n=1 then 'PASS' else 'FAIL (deleted)' end);

  select count(*) into n from public.safeguarding_officers where academy_id = ACAD_B;
  insert into rls_results values (28,'another academy''s officers are invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  b := false;
  begin
    insert into public.safeguarding_officers (academy_id, profile_id) values (ACAD_A, PARENT);
  exception when others then b := true;
  end;
  insert into rls_results values (29,'a parent cannot appoint a safeguarding officer',
    case when b then 'PASS' else 'FAIL' end);

  execute 'reset role';

  -- ================== clearances (0120) ==================
  -- A clearance number is a government identifier attached to a named adult.
  -- Club OWNERS and ADMINS need it to do the verification; a coach does not,
  -- and a parent certainly does not — "the coach is verified" is a fact the
  -- directory can show without the number.
  insert into public.staff_clearances
    (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
  values (ACAD_A, MARCUS, 'wwcc', 'RLSPROBE', 'cleared', current_date + 200, COACH);

  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.staff_clearances where number = 'RLSPROBE';
  insert into rls_results values (30,'a parent cannot read a clearance number',
    case when n=0 then 'PASS' else 'FAIL ('||n||' visible)' end);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  -- The subject of the record is a coach, not an admin. Even their own row is
  -- not theirs to read, which is the same reasoning as the safeguarding
  -- queue: the person a check protects children from must not be the person
  -- who can see or change it.
  select count(*) into n from public.staff_clearances where number = 'RLSPROBE';
  insert into rls_results values (31,'nor can a coach, not even their own',
    case when n=0 then 'PASS' else 'FAIL ('||n||' visible)' end);

  b := false;
  begin
    insert into public.staff_clearances
      (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
    values (ACAD_A, MARCUS, 'wwcc', 'SELF', 'cleared', current_date + 900, MARCUS);
  exception when others then b := true;
  end;
  insert into rls_results values (32,'and cannot write one directly',
    case when b then 'PASS' else 'FAIL' end);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.staff_clearances where number = 'RLSPROBE';
  insert into rls_results values (33,'an owner can read it, which is the point',
    case when n=1 then 'PASS' else 'FAIL ('||n||')' end);

  select count(*) into n from public.staff_clearances where academy_id = ACAD_B;
  insert into rls_results values (34,'another academy''s clearances are invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  execute 'reset role';
  delete from public.staff_clearances where number in ('RLSPROBE', 'SELF');
  delete from public.message_reports where note in ('rls probe', 'direct insert');
  delete from public.safeguarding_officers where academy_id = ACAD_A and profile_id = PARENT;

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

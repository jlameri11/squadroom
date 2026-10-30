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
  v_ev uuid; v_ev_total int; v_msg uuid; v_comp uuid;
begin
  -- For checks 44–45. Read here, before any role switch, so it is a real id.
  select id into v_comp from public.competitions limit 1;
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

  -- ================== public registrations (0122) ==================
  -- The only table in the schema written by anonymous strangers. A row holds
  -- a child's date of birth and a family's phone number before anybody has
  -- agreed to anything, and before a club has decided whether it wants them.
  insert into public.registration_requests
    (academy_id, program_id, guardian_name, guardian_phone,
     child_name, child_dob, secret_hash)
  select ACAD_A, p.id, 'RLS Probe Parent', '+61400009999',
         'RLS Probe Child', '2016-06-15', 'nothashedreally'
    from public.programs p where p.academy_id = ACAD_A limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.registration_requests where child_name = 'RLS Probe Child';
  insert into rls_results values (35,'a parent cannot read another family''s registration',
    case when n=0 then 'PASS' else 'FAIL ('||n||' visible)' end);

  -- Insert is `with check (false)` for everyone: submission goes through the
  -- route that holds the rate limit, the eligibility rules and the consent
  -- check. A policy allowing it would be a policy skipping all three.
  b := false;
  begin
    insert into public.registration_requests
      (academy_id, program_id, guardian_name, child_name, child_dob, secret_hash)
    select ACAD_A, p.id, 'Direct', 'Direct', '2016-01-01', 'x'
      from public.programs p where p.academy_id = ACAD_A limit 1;
  exception when others then b := true;
  end;
  insert into rls_results values (36,'and cannot submit one directly',
    case when b then 'PASS' else 'FAIL' end);

  -- Hashed addresses. Nobody but the service role has any business here.
  select count(*) into n from public.registration_attempts;
  insert into rls_results values (37,'the rate-limit table is invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||' rows)' end);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.registration_requests where child_name = 'RLS Probe Child';
  insert into rls_results values (38,'a coach at the club can, which is the point',
    case when n=1 then 'PASS' else 'FAIL ('||n||')' end);

  -- A decision has to go through the route that creates the account, so even
  -- a coach cannot move the status by hand.
  update public.registration_requests set status = 'approved'
   where child_name = 'RLS Probe Child';
  select count(*) into n from public.registration_requests
   where child_name = 'RLS Probe Child' and status = 'pending';
  insert into rls_results values (39,'nor decide one by hand',
    case when n=1 then 'PASS' else 'FAIL (status moved)' end);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.registration_requests where academy_id = ACAD_A;
  insert into rls_results values (40,'another academy''s registrations are invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);

  execute 'reset role';

  -- ================== team sheets (0125) ==================
  -- A team sheet is a list of children's names with their positions. The
  -- draft rule lives in `event_lineup()`, so the TABLES must be unreadable
  -- to a parent — otherwise a published-only rule is a rule anybody can read
  -- around by querying the table instead of calling the function.
  select id into v_ev from public.events
   where academy_id = ACAD_A and type = 'match' and team_id = '00000000-0000-0000-0000-0000000d0008'
   limit 1;

  if v_ev is not null then
    insert into public.event_lineups (academy_id, event_id, created_by)
    values (ACAD_A, v_ev, COACH)
    on conflict (event_id) do update set updated_at = now();

    insert into public.event_lineup_players (academy_id, lineup_id, player_id, role)
    select ACAD_A, l.id, pl.id, 'starting'
      from public.event_lineups l, public.players pl
     where l.event_id = v_ev and pl.id = '00000000-0000-0000-0000-0000000e0001'
    on conflict (lineup_id, player_id) do nothing;

    perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
    execute 'set local role authenticated';

    select count(*) into n from public.event_lineups where event_id = v_ev;
    insert into rls_results values (41,'a parent cannot read a team sheet directly',
      case when n=0 then 'PASS' else 'FAIL ('||n||' visible)' end);

    select count(*) into n from public.event_lineup_players;
    insert into rls_results values (42,'nor the names on one',
      case when n=0 then 'PASS' else 'FAIL ('||n||' visible)' end);

    b := false;
    begin
      insert into public.event_lineups (academy_id, event_id, created_by)
      values (ACAD_A, v_ev, PARENT);
    exception when others then b := true;
    end;
    insert into rls_results values (43,'and cannot write one',
      case when b then 'PASS' else 'FAIL' end);

    execute 'reset role';
    delete from public.event_lineups where event_id = v_ev;
  end if;

  -- 0136. A parent sees only their own children, and answers only for them.
  -- 46. my_family returns nothing that is not theirs.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n
    from jsonb_array_elements(public.my_family()) c
   where not exists (
     select 1 from public.player_guardians pg
      where pg.player_id = (c->>'id')::uuid and pg.profile_id = PARENT
   );
  insert into rls_results values (46,'my_family lists only the caller''s own children',
    case when n=0 then 'PASS' else 'FAIL ('||n||' not theirs)' end);
  -- 47. and cannot answer an agreement for somebody else's child.
  b := false;
  begin
    perform public.set_consent(
      (select id from public.players where academy_id = ACAD_B limit 1),
      gen_random_uuid(), false);
  exception when others then b := true;
  end;
  insert into rls_results values (47,'a parent cannot answer for another family''s child',
    case when b then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- 0140. Offers: nobody writes the table directly, and another club's are
  -- invisible.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into public.offers (academy_id, trial_registration_id, player_id, squad_program_id, expires_at)
    values (ACAD_A, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now() + interval '7 days');
  exception when others then b := true;
  end;
  insert into rls_results values (48,'an offer cannot be written directly',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.offers where academy_id = ACAD_B;
  insert into rls_results values (49,'academy B offers invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';

  -- 0145. Refunds: nobody writes the table directly; another club's are
  -- invisible.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into public.refunds (academy_id, registration_id, player_id, payment_id, amount_cents)
    values (ACAD_A, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 100);
  exception when others then b := true;
  end;
  insert into rls_results values (50,'a refund cannot be written directly',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.refunds where academy_id = ACAD_B;
  insert into rls_results values (51,'academy B refunds invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';

  -- 0146. A player photo cannot be put under another club's name, and
  -- another club's cannot be listed.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('player-photos', ACAD_B::text || '/' || gen_random_uuid()::text || '/x.jpg', PARENT);
  exception when others then b := true;
  end;
  insert into rls_results values (52,'a photo cannot be written under another club',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from storage.objects
   where bucket_id = 'player-photos' and (storage.foldername(name))[1] = ACAD_B::text;
  insert into rls_results values (53,'academy B player photos invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';

  -- 0148. Division rules: only the organiser writes them; a competition
  -- you are not in shows none.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into public.competition_divisions (competition_id, division, points_win)
    values (v_comp, 'RLS probe', 9);
  exception when others then b := true;
  end;
  insert into rls_results values (54,'a parent cannot write division rules',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.competition_divisions d
   where not exists (select 1 from public.competition_clubs cc
                      where cc.competition_id = d.competition_id and cc.academy_id = ACAD_A)
     and not exists (select 1 from public.competitions c
                      where c.id = d.competition_id and c.organiser_id = ACAD_A);
  insert into rls_results values (55,'another competition''s division rules invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';

  -- 0151. Match sheets, squads, events and the log: written by functions
  -- only, and a competition you are not in shows nothing.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into public.match_sheets (competition_id, fixture_id, entry_id)
    values (v_comp, gen_random_uuid(), gen_random_uuid());
  exception when others then b := true;
  end;
  insert into rls_results values (56,'a match sheet cannot be written directly',
    case when b then 'PASS' else 'FAIL' end);
  b := false;
  begin
    insert into public.match_events (competition_id, fixture_id, entry_id, kind)
    values (v_comp, gen_random_uuid(), gen_random_uuid(), 'goal');
  exception when others then b := true;
  end;
  insert into rls_results values (57,'a match event cannot be written directly',
    case when b then 'PASS' else 'FAIL' end);
  b := false;
  begin
    insert into public.entry_squads (competition_id, entry_id, academy_id, player_id)
    values (v_comp, gen_random_uuid(), ACAD_B, gen_random_uuid());
  exception when others then b := true;
  end;
  insert into rls_results values (58,'a parent cannot write a season squad',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.match_sheets s
   where not exists (select 1 from public.competition_clubs cc
                      where cc.competition_id = s.competition_id and cc.academy_id = ACAD_A)
     and not exists (select 1 from public.competitions c
                      where c.id = s.competition_id and (c.organiser_id = ACAD_A or c.visibility = 'public'));
  insert into rls_results values (59,'another competition''s sheets invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';

  -- 0153. Suspensions are written by triggers and the organiser's
  -- functions; discipline rules by the organiser; both invisible outside.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into public.suspensions (competition_id, player_id, academy_id, reason, games)
    values (v_comp, gen_random_uuid(), ACAD_A, 'probe', 1);
  exception when others then b := true;
  end;
  insert into rls_results values (60,'a suspension cannot be written directly',
    case when b then 'PASS' else 'FAIL' end);
  b := false;
  begin
    insert into public.competition_discipline_rules (competition_id, games_per_red) values (v_comp, 9);
  exception when others then b := true;
  end;
  insert into rls_results values (61,'a parent cannot write discipline rules',
    case when b then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- 0158. Ladder adjustments: organiser only, and invisible outside.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into public.ladder_adjustments (competition_id, division, entry_id, points, reason)
    values (v_comp, 'probe', gen_random_uuid(), -1, 'probe');
  exception when others then b := true;
  end;
  insert into rls_results values (62,'a parent cannot adjust a ladder',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.ladder_adjustments a
   where not exists (select 1 from public.competition_clubs cc
                      where cc.competition_id = a.competition_id and cc.academy_id = ACAD_A)
     and not exists (select 1 from public.competitions c
                      where c.id = a.competition_id and (c.organiser_id = ACAD_A or c.visibility = 'public'));
  insert into rls_results values (63,'another competition''s adjustments invisible',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';

  -- 0161. Referees: the pool is the league's; a parent at a club can
  -- neither read it nor appoint from it.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.referees;
  insert into rls_results values (64,'a parent sees no referee pool (no phone numbers)',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  b := false;
  begin
    perform public.appoint_referee(gen_random_uuid(), gen_random_uuid());
  exception when others then b := true;
  end;
  insert into rls_results values (65,'a parent cannot appoint a referee',
    case when b then 'PASS' else 'FAIL' end);
  -- 0162. A parent cannot confirm a PlayFootball registration, and cannot
  -- import an export.
  b := false;
  begin
    perform public.confirm_official_rego(gen_random_uuid(), true);
  exception when others then b := true;
  end;
  insert into rls_results values (66,'a parent cannot confirm a PlayFootball registration',
    case when b then 'PASS' else 'FAIL' end);
  b := false;
  begin
    perform public.import_official_status(ACAD_A, '[]'::jsonb);
  exception when others then b := true;
  end;
  insert into rls_results values (67,'a parent cannot import a PlayFootball export',
    case when b then 'PASS' else 'FAIL' end);
  -- 0163. Referee money is the league's: a parent neither sets a fee nor
  -- builds a run, and sees no payment item.
  b := false;
  begin
    perform public.set_referee_fee(v_comp, 'referee', 5000);
  exception when others then b := true;
  end;
  insert into rls_results values (68,'a parent cannot set a referee fee',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.referee_payment_items;
  insert into rls_results values (69,'a parent sees no referee payment items',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0164. League roles are handed out by the league's staff and nobody else.
  b := false;
  begin
    insert into public.league_roles (academy_id, profile_id, role) values (ACAD_A, PARENT, 'competition_manager');
  exception when others then b := true;
  end;
  insert into rls_results values (70,'a parent cannot give themselves a league role',
    case when b then 'PASS' else 'FAIL' end);
  b := false;
  begin
    perform public.grant_league_role(v_comp, PARENT, 'competition_manager');
  exception when others then b := true;
  end;
  insert into rls_results values (71,'a parent cannot grant a league role by function',
    case when b then 'PASS' else 'FAIL' end);
  -- 0166. A parent cannot import a league's draw.
  b := false;
  begin
    perform public.import_league_draw(v_comp, '[]'::jsonb);
  exception when others then b := true;
  end;
  insert into rls_results values (72,'a parent cannot import a league draw',
    case when b then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- 0132. Two functions were callable by anyone with a uuid. Asserted the
  -- way the holes were found: by calling them as the wrong person.
  --
  -- 44. A parent is not a competition organiser and cannot seed the finals.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    perform public.resolve_finals(v_comp, 'U8s');
  exception when others then b := true;
  end;
  insert into rls_results values (44,'a parent cannot seed a competition''s finals',
    case when b then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- 45. A stranger cannot re-sync a fixture into a club's events — the path
  -- that could un-cancel a called-off game.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  b := false;
  begin
    perform public.mirror_fixture(gen_random_uuid());
  exception when others then b := true;
  end;
  -- Back to ourselves BEFORE writing the result: the results table grants
  -- insert to authenticated only, and anon writing it is its own refusal.
  execute 'reset role';
  insert into rls_results values (45,'a stranger cannot re-sync a fixture',
    case when b then 'PASS' else 'FAIL' end);

  delete from public.registration_requests where child_name in ('RLS Probe Child', 'Direct');
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

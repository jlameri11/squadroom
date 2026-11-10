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
  v_u8 uuid; v_rv uuid; n int; b bool; b2 bool; foreign_rows int;
  v_kid uuid; v_g1 uuid; v_g2 uuid; v_ev114 uuid; v_grid jsonb; v_going int; v_maybe int; v_total int; v_roster int;
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
  -- 0167. Entry fees and entry requests are the league's.
  b := false;
  begin
    perform public.set_competition_fee(v_comp, '', 5000, null);
  exception when others then b := true;
  end;
  insert into rls_results values (73,'a parent cannot set an entry fee',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.competition_entry_requests;
  insert into rls_results values (74,'a parent sees no entry requests (no contacts)',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';

  -- 0168. A concussion is the family's and the club's; another tenant sees
  -- none, and a parent cannot clear their own child.
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.player_concussions c
   where c.academy_id = ACAD_A;
  insert into rls_results values (75,'another tenant sees no concussion records',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    perform public.decide_concussion_clearance(gen_random_uuid(), true);
  exception when others then b := true;
  end;
  insert into rls_results values (76,'a parent cannot clear a concussion',
    case when b then 'PASS' else 'FAIL' end);
  -- 0169. The conduct register is the officers'.
  perform public.conduct_register(ACAD_A);
  select count(*) into n from public.conduct_reports r
   where r.academy_id = ACAD_A and r.reported_by <> PARENT;
  insert into rls_results values (77,'a parent sees nobody else''s conduct reports',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  b := false;
  begin
    perform public.review_conduct_report(gen_random_uuid(), 'closed', 'x', null);
  exception when others then b := true;
  end;
  insert into rls_results values (78,'a parent cannot review a conduct report',
    case when b then 'PASS' else 'FAIL' end);
  execute 'reset role';
  -- 0171. A child's privacy facts are the family's and the club's.
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    perform public.child_privacy((select id from public.players where academy_id = ACAD_A limit 1));
  exception when others then b := true;
  end;
  insert into rls_results values (79,'another tenant cannot read a child''s privacy facts',
    case when b then 'PASS' else 'FAIL' end);
  execute 'reset role';
  -- 0172. Proposing a day's appointments is the coordinator's.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    perform public.propose_referee_allocation(v_comp, current_date, null);
  exception when others then b := true;
  end;
  insert into rls_results values (80,'a parent cannot propose referee appointments',
    case when b then 'PASS' else 'FAIL' end);
  -- 0174. A change to a game is the clubs' and the league's.
  b := false;
  begin
    perform public.decide_fixture_change(gen_random_uuid(), true, null);
  exception when others then b := true;
  end;
  insert into rls_results values (81,'a parent cannot decide a game change',
    case when b then 'PASS' else 'FAIL' end);
  select count(*) into n from public.fixture_change_requests;
  insert into rls_results values (82,'a parent sees no game-change requests',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0175. Respect marks are read through the dashboard, never the table.
  select count(*) into n from public.respect_marks;
  insert into rls_results values (83,'a parent reads no respect marks',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  b := false;
  begin
    perform public.give_respect_marks(gen_random_uuid(), gen_random_uuid(), 1, 1, 1, null);
  exception when others then b := true;
  end;
  insert into rls_results values (84,'a parent cannot give respect marks',
    case when b then 'PASS' else 'FAIL' end);
  -- 0176. The check-in code is for the game's managers and the league.
  b := (select public.fixture_checkin_key(f.id) is null from public.fixtures f where f.competition_id = v_comp limit 1);
  insert into rls_results values (85,'a parent is not handed a check-in code',
    case when coalesce(b, true) then 'PASS' else 'FAIL' end);
  execute 'reset role';
  -- 0177. A translation is the channel's; the budget is the server's.
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.message_translations t
   where exists (select 1 from public.messages m where m.id = t.message_id and m.academy_id = ACAD_A);
  insert into rls_results values (86,'another tenant reads no translations of our messages',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  b := false;
  begin
    perform public.translation_budget_take(OUTSIDER, ACAD_A, 1);
  exception when others then b := true;
  end;
  insert into rls_results values (87,'a person cannot spend the translation budget directly',
    case when b then 'PASS' else 'FAIL' end);
  -- 0179. Who can be named in a channel is the channel's business.
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from jsonb_array_elements(public.channel_mentionables(
    (select c.id from public.channels c where c.academy_id = ACAD_A and c.status = 'active' limit 1)));
  insert into rls_results values (88,'another tenant cannot list who is in our channel',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';
  -- 0180. A scheduled message is the sender's alone until it goes — not
  -- even a host reads it.
  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.messages m
   where m.status = 'scheduled' and m.sender_id <> COACH;
  insert into rls_results values (89,'a host reads nobody else''s scheduled messages',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';
  -- 0183 recreated channel_messages with the thread columns. The feed is
  -- still the channel's: another tenant reads nothing from it.
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.channel_messages(
    (select c.id from public.channels c where c.academy_id = ACAD_A and c.status = 'active' limit 1), null, 50);
  insert into rls_results values (90,'another tenant reads none of our feed, threads included',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  execute 'reset role';
  -- 0184 widened what the attachments bucket accepts. It is still private:
  -- a voice note of a coach or a clip of somebody's child is never a
  -- permanent public link.
  select count(*) into n from storage.buckets b where b.id = 'attachments' and b.public;
  insert into rls_results values (91,'the attachments bucket stays private with voice and video in it',
    case when n=0 then 'PASS' else 'FAIL' end);
  -- 0185. A stranger can call exactly the functions on the allow-list and
  -- nothing else. This fails the day a migration adds an anon-callable
  -- function without adding it to app_private.anon_callable with a reason.
  -- (Trigger functions are left out: PostgREST cannot call one whatever its grant.)
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from app_private.anon_callable);
  insert into rls_results values (92,'no function outside the allow-list is callable by a stranger',
    case when n=0 then 'PASS' else 'FAIL ('||n||' off-list: '||(
      select string_agg(p.proname, ', ') from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in (select proname from app_private.anon_callable))||')' end);
  -- And every security-definer function a signed-in person can call names
  -- its caller somewhere in its body, bar the public five.
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f' and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and p.proname not in (select proname from app_private.anon_callable)
     and pg_get_functiondef(p.oid) !~ '(auth\.uid|app_private\.|is_platform_admin|may_run|is_competition_organiser|is_academy_|is_team_|is_channel_|is_guardian|current_setting\(.request)';
  insert into rls_results values (93,'every security-definer function a member can call checks who is calling',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0186. Home's jobs strip is resolved to the caller's own organisation:
  -- asking for ours from another club answers about theirs, never ours.
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from (select public.home_jobs(ACAD_A) as j) x
   where (x.j->>'academy_id')::uuid = ACAD_A;
  insert into rls_results values (94,'another tenant asking for our home jobs gets their own',
    case when n=0 then 'PASS' else 'FAIL' end);
  execute 'reset role';
  -- 0187. A parent can neither end a game nor read the corrections table.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    perform public.end_match((select f.id from public.fixtures f order by f.created_at limit 1));
  exception when others then b := true;
  end;
  select count(*) into n from public.match_corrections;
  execute 'reset role';
  insert into rls_results values (95,'a parent cannot end a game and sees no correction requests',
    case when b and n=0 then 'PASS' else 'FAIL' end);
  -- 0189. The draw check and the match-day list are the league's: a parent
  -- gets nothing, and cannot open fixture flowing.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from (select public.match_day_ops(v_comp) as o) x where x.o is not null;
  select n + count(*) into n from (select public.draw_quality(v_comp, 'U8s') as q) x where x.q is not null;
  b := false;
  begin
    perform public.set_fixture_flowing(v_comp, now() + interval '7 days', 3);
  exception when others then b := true;
  end;
  execute 'reset role';
  insert into rls_results values (96,'the draw check, the match-day list and fixture flowing are the league''s alone',
    case when n=0 and b then 'PASS' else 'FAIL' end);
  -- 0190. A parent can neither ask for a forfeit nor verify a game as the
  -- referee, and reads no forfeit requests.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    perform public.request_forfeit((select f.id from public.fixtures f where f.home_entry_id is not null order by f.created_at limit 1),
                                   (select f.home_entry_id from public.fixtures f where f.home_entry_id is not null order by f.created_at limit 1), 'rls probe');
  exception when others then b := true;
  end;
  b2 := false;
  begin
    perform public.referee_verify_by_phone((select f.id from public.fixtures f order by f.created_at limit 1), '0400000000', 'Confirm');
  exception when others then b2 := true;
  end;
  select count(*) into n from public.forfeit_requests;
  execute 'reset role';
  insert into rls_results values (97,'a parent cannot ask for a forfeit, verify a game, or read forfeit requests',
    case when b and b2 and n=0 then 'PASS' else 'FAIL' end);
  -- 0191. The referee rules, a nomination, a bulk score and a round's move
  -- are all refused to a parent; the nominations list is empty for them.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  n := 0;
  begin
    perform public.set_referee_rules(v_comp, 12, true, null, 24);
  exception when others then n := n + 1;
  end;
  begin
    perform public.bulk_scores(v_comp, '[]'::jsonb);
  exception when others then n := n + 1;
  end;
  begin
    perform public.shift_round(v_comp, 'U8s', 'Round 1', 7);
  exception when others then n := n + 1;
  end;
  begin
    perform public.nominate_entry((select e.id from public.competition_entries e where e.competition_id = v_comp limit 1), 'Division 1', null);
  exception when others then n := n + 1;
  end;
  b := public.entry_nominations(v_comp) is null;
  execute 'reset role';
  insert into rls_results values (98,'referee rules, nominations, bulk scores and round moves are the league''s',
    case when n=4 and b then 'PASS' else 'FAIL ('||n||')' end);
  -- 0192. The setup checklist is the club's staff's: a parent gets nothing,
  -- another tenant asking for ours gets their own, and neither sets a crest.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := public.setup_progress(ACAD_A) is null;
  b2 := false;
  begin
    perform public.set_academy_logo(ACAD_A, 'https://x/storage/v1/object/public/club-logos/' || ACAD_A || '/crest.png');
  exception when others then b2 := true;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from (select public.setup_progress(ACAD_A) as s) x where (x.s->>'academy_id')::uuid = ACAD_A;
  execute 'reset role';
  insert into rls_results values (99,'the setup checklist and the crest are the club''s staff''s alone',
    case when b and b2 and n=0 then 'PASS' else 'FAIL' end);
  -- 0193. Vouchers are the club's: a parent lists none and cannot make one;
  -- another tenant's staff see none of ours.
  insert into public.vouchers (academy_id, code, label, kind, amount_cents) values (ACAD_A, 'RLSPROBE', 'rls probe', 'club', 1000);
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.vouchers;
  b := false;
  begin
    insert into public.vouchers (academy_id, code, label, kind, amount_cents) values (ACAD_A, 'PARENTPROBE', 'nope', 'club', 1000);
  exception when others then b := true;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select n + count(*) into n from public.vouchers where academy_id = ACAD_A;
  execute 'reset role';
  delete from public.vouchers where code in ('RLSPROBE', 'PARENTPROBE');
  insert into rls_results values (100,'vouchers are the club''s staff''s: a parent sees and makes none, another tenant sees none of ours',
    case when n=0 and b then 'PASS' else 'FAIL ('||n||')' end);
  -- 0194. A channel's members may say they are typing on their own topic and
  -- nobody else's; link previews are read by anyone signed in and written
  -- by nobody but the server; a parent reads receipts for their own
  -- messages only.
  b := exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                 and policyname = 'channel_members_may_say_they_are_typing' and cmd = 'INSERT');
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b2 := false;
  begin
    insert into public.link_previews (url, ok, title) values ('https://example.invalid/rls', true, 'rls probe');
  exception when others then b2 := true;
  end;
  select count(*) into n from public.read_receipts(
    (select m.channel_id from public.messages m where m.sender_id = COACH and m.status = 'published' order by m.created_at desc limit 1),
    array[(select m.id from public.messages m where m.sender_id = COACH and m.status = 'published' order by m.created_at desc limit 1)]);
  execute 'reset role';
  insert into rls_results values (101,'typing is a member''s own topic; previews are read-only; receipts are the sender''s or a host''s',
    case when b and b2 and n=0 then 'PASS' else 'FAIL' end);
  -- 0195. Every poll option is an object with an id and a label; a plain
  -- string renders as a blank option with no votes.
  select count(*) into n from public.polls p
   where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p.options) = 'array' then p.options else '[]'::jsonb end) o
                  where jsonb_typeof(o) <> 'object' or o ->> 'id' is null or o ->> 'label' is null);
  insert into rls_results values (102,'every poll option is an object with an id and a label',
    case when n=0 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0196. A coach's note never reaches the family; a shared report does; an
  -- unshared clip does not; a parent writes none; a stranger sees none.
  insert into public.player_reports (id, academy_id, player_id, author_id, kind, body)
    values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000e0001', COACH, 'note', 'rls probe note');
  insert into public.player_reports (id, academy_id, player_id, author_id, kind, body, shared_with_family, published_at)
    values ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000e0001', COACH, 'report', 'rls probe report', true, now());
  insert into public.player_clips (id, academy_id, player_id, added_by, url, title, shared_with_family)
    values ('00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000e0001', COACH, 'https://example.com/rls-clip', 'rls probe clip', false);
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.player_reports where body like 'rls probe%';
  b := (n = 1);
  select count(*) into n from public.player_clips where title = 'rls probe clip';
  b := b and n = 0;
  b2 := false;
  begin
    insert into public.player_reports (academy_id, player_id, author_id, kind, body)
      values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000e0001', PARENT, 'note', 'rls parent note');
  exception when others then b2 := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c2','role','authenticated')::text, true);
  select count(*) into n from public.player_reports where body like 'rls probe%';
  execute 'reset role';
  delete from public.player_reports where id in ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ee02');
  delete from public.player_clips where id = '00000000-0000-0000-0000-00000000ee03';
  insert into rls_results values (103,'a coach''s note never reaches the family, a shared report does, a parent writes none, a stranger sees none',
    case when b and b2 and n=0 then 'PASS' else 'FAIL' end);
  -- 0198. A ground's layout: the club's members read it, its staff draw it,
  -- another club sees none of it through the tables and a parent cannot
  -- draw on it.
  insert into public.venues (id, academy_id, name) values ('00000000-0000-0000-0000-00000000ee10', '00000000-0000-0000-0000-0000000a0001', 'rls probe ground')
    on conflict (id) do nothing;
  insert into public.pitches (id, academy_id, venue_id, name) values ('00000000-0000-0000-0000-00000000ee11', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee10', 'rls probe pitch');
  insert into public.pitch_availability (academy_id, pitch_id, weekday, opens, closes) values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee11', 6, '08:00', '12:00');
  insert into public.pitch_size_rules (academy_id, age_group, size) values ('00000000-0000-0000-0000-0000000a0001', 'U99', 'third') on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.pitches where id = '00000000-0000-0000-0000-00000000ee11';
  b := (n = 1);
  select count(*) into n from public.pitch_availability where pitch_id = '00000000-0000-0000-0000-00000000ee11';
  b := b and n = 1;
  b2 := false;
  begin
    insert into public.pitches (academy_id, venue_id, name) values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee10', 'rls parent pitch');
  exception when others then b2 := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  select count(*) into n from public.pitches where venue_id = '00000000-0000-0000-0000-00000000ee10';
  select n + count(*) into n from public.pitch_size_rules where academy_id = '00000000-0000-0000-0000-0000000a0001' and age_group = 'U99';
  execute 'reset role';
  delete from public.pitch_size_rules where academy_id = '00000000-0000-0000-0000-0000000a0001' and age_group = 'U99';
  delete from public.pitches where id = '00000000-0000-0000-0000-00000000ee11';
  delete from public.venues where id = '00000000-0000-0000-0000-00000000ee10';
  insert into rls_results values (104,'a ground''s layout: members read it, staff draw it, a parent cannot, another club sees none',
    case when b and b2 and n=0 then 'PASS' else 'FAIL' end);
  -- 0200. The match-day list's ticks are the squad's coaches'; a parent
  -- neither reads nor makes one.
  insert into public.events (id, academy_id, team_id, type, title, starts_at, created_by)
    values ('00000000-0000-0000-0000-00000000ee20', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000d0008', 'match', 'rls probe match', now() + interval '2 days', COACH);
  insert into public.event_checklist_ticks (academy_id, event_id, item, ticked_by)
    values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee20', 'kit', COACH);
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.event_checklist_ticks where event_id = '00000000-0000-0000-0000-00000000ee20';
  b2 := false;
  begin
    insert into public.event_checklist_ticks (academy_id, event_id, item, ticked_by)
      values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee20', 'sheet', PARENT);
  exception when others then b2 := true;
  end;
  execute 'reset role';
  delete from public.events where id = '00000000-0000-0000-0000-00000000ee20';
  insert into rls_results values (105,'the match-day list''s ticks are the coaches'': a parent neither reads nor makes one',
    case when n=0 and b2 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0202. A game's stats are the squad's: its parent reads them, cannot
  -- write them, and another club sees none; a vote is the voter's own.
  insert into public.events (id, academy_id, team_id, type, title, starts_at, created_by)
    values ('00000000-0000-0000-0000-00000000ee30', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000d0008', 'match', 'rls probe stats', now() - interval '1 day', COACH);
  insert into public.event_player_stats (academy_id, event_id, player_id, goals, entered_by)
    values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee30', '00000000-0000-0000-0000-0000000e0001', 2, COACH);
  insert into public.potm_votes (academy_id, event_id, voter_id, player_id)
    values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee30', COACH, '00000000-0000-0000-0000-0000000e0001');
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.event_player_stats where event_id = '00000000-0000-0000-0000-00000000ee30';
  b := (n = 1);
  select count(*) into n from public.potm_votes where event_id = '00000000-0000-0000-0000-00000000ee30';
  b := b and n = 0;   -- the coach's vote is not the parent's to see
  b2 := false;
  begin
    update public.event_player_stats set goals = 9 where event_id = '00000000-0000-0000-0000-00000000ee30';
    if not found then b2 := true; end if;
  exception when others then b2 := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  select count(*) into n from public.event_player_stats where event_id = '00000000-0000-0000-0000-00000000ee30';
  execute 'reset role';
  delete from public.events where id = '00000000-0000-0000-0000-00000000ee30';
  insert into rls_results values (106,'a game''s stats are the squad''s: its parent reads, cannot write, another club sees none; a vote is the voter''s',
    case when b and b2 and n=0 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0203. The ticker is the squad's to read and nobody's to write directly.
  insert into public.events (id, academy_id, team_id, type, title, starts_at, created_by)
    values ('00000000-0000-0000-0000-00000000ee40', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000d0008', 'match', 'rls probe live', now() - interval '1 hour', COACH);
  insert into public.event_ticker (academy_id, event_id, kind, created_by)
    values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee40', 'kick_off', COACH);
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.event_ticker where event_id = '00000000-0000-0000-0000-00000000ee40';
  b := (n = 1);
  b2 := false;
  begin
    insert into public.event_ticker (academy_id, event_id, kind, created_by)
      values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee40', 'goal_for', PARENT);
  exception when others then b2 := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  select count(*) into n from public.event_ticker where event_id = '00000000-0000-0000-0000-00000000ee40';
  execute 'reset role';
  delete from public.events where id = '00000000-0000-0000-0000-00000000ee40';
  insert into rls_results values (107,'the ticker is the squad''s to read and nobody''s to write directly; another club sees none',
    case when b and b2 and n=0 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0204. A family's pulse is its own; a parent sees nobody else's and
  -- cannot write one directly.
  insert into public.events (id, academy_id, team_id, type, title, starts_at, created_by)
    values ('00000000-0000-0000-0000-00000000ee50', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000d0008', 'match', 'rls probe pulse', now() - interval '1 day', COACH);
  insert into public.event_pulse (academy_id, event_id, profile_id, mood)
    values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee50', '00000000-0000-0000-0000-0000000000b2', 1);
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.event_pulse where event_id = '00000000-0000-0000-0000-00000000ee50';
  b2 := false;
  begin
    insert into public.event_pulse (academy_id, event_id, profile_id, mood)
      values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee50', PARENT, 3);
  exception when others then b2 := true;
  end;
  execute 'reset role';
  delete from public.events where id = '00000000-0000-0000-0000-00000000ee50';
  insert into rls_results values (108,'a family''s pulse is its own: another parent sees none and cannot write one directly',
    case when n=0 and b2 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0205. A support request is its writer's and Squadroom's; a club's
  -- sponsors are its members' to see, its staff's to keep.
  insert into public.support_requests (id, academy_id, profile_id, subject, body)
    values ('00000000-0000-0000-0000-00000000ee60', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000b2', 'rls probe', 'rls probe');
  insert into public.academy_sponsors (id, academy_id, name)
    values ('00000000-0000-0000-0000-00000000ee61', '00000000-0000-0000-0000-0000000a0001', 'rls probe sponsor');
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.support_requests where id = '00000000-0000-0000-0000-00000000ee60';
  b := (n = 0);   -- another family's request
  select count(*) into n from public.academy_sponsors where id = '00000000-0000-0000-0000-00000000ee61';
  b := b and n = 1;   -- the club's sponsor, readable
  b2 := false;
  begin
    insert into public.academy_sponsors (academy_id, name) values ('00000000-0000-0000-0000-0000000a0001', 'rls parent sponsor');
  exception when others then b2 := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  select count(*) into n from public.academy_sponsors where id = '00000000-0000-0000-0000-00000000ee61';
  execute 'reset role';
  delete from public.support_requests where id = '00000000-0000-0000-0000-00000000ee60';
  delete from public.academy_sponsors where id = '00000000-0000-0000-0000-00000000ee61';
  insert into rls_results values (109,'a support request is its writer''s; a club''s sponsors are its members'' to see, its staff''s to keep, nobody else''s',
    case when b and b2 and n=0 then 'PASS' else 'FAIL ('||n||')' end);
  -- 0206. A game's video is the squad's to see, the coach's to add, and
  -- nobody's to write directly.
  insert into public.events (id, academy_id, team_id, type, title, starts_at, created_by)
    values ('00000000-0000-0000-0000-00000000ee70', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000d0008', 'match', 'rls probe video', now() - interval '1 day', COACH);
  insert into public.event_videos (academy_id, event_id, kind, url, added_by)
    values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee70', 'link', 'https://example.com/rls', COACH);
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.event_videos where event_id = '00000000-0000-0000-0000-00000000ee70';
  b := (n = 1);
  b2 := false;
  begin
    insert into public.event_videos (academy_id, event_id, kind, url, added_by)
      values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000ee70', 'link', 'https://example.com/parent', PARENT);
  exception when others then b2 := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  select count(*) into n from public.event_videos where event_id = '00000000-0000-0000-0000-00000000ee70';
  execute 'reset role';
  delete from public.events where id = '00000000-0000-0000-0000-00000000ee70';
  insert into rls_results values (110,'a game''s video is the squad''s to see, nobody''s to write directly, and another club sees none',
    case when b and b2 and n=0 then 'PASS' else 'FAIL ('||n||')' end);

  -- 0208. A coach runs their squad, not the club: starting a competition
  -- is the staff's. (0022 let any coach of the organisation do it, and the
  -- Admin hub offered it; both changed on 4 Nov 2026.)
  perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  b := false;
  begin
    insert into public.competitions (organiser_id, name, type, season, status, mode, visibility, created_by)
      values (ACAD_A, 'rls probe coach cup', 'tournament', '2026', 'active', 'managed', 'participants', MARCUS);
  exception when others then b := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  b2 := false;
  begin
    insert into public.competitions (organiser_id, name, type, season, status, mode, visibility, created_by)
      values (ACAD_A, 'rls probe owner cup', 'tournament', '2026', 'active', 'managed', 'participants', COACH);
    b2 := true;
  exception when others then b2 := false;
  end;
  execute 'reset role';
  delete from public.competitions where name in ('rls probe coach cup', 'rls probe owner cup');
  insert into rls_results values (111,'a coach cannot start a competition under the club''s name; its owner can',
    case when b and b2 then 'PASS' else 'FAIL (coach refused '||b||', owner allowed '||b2||')' end);

  -- 0209. A club's colours and logo are its owner's and admins' to change:
  -- not a coach's, not a family's. Tried as each of them, on every branding
  -- column — each write a self-assignment, so a broken rule is reported
  -- without changing anybody's colours.
  -- 112.
  perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  with u as (update public.academies set primary_colour = primary_colour, secondary_colour = secondary_colour, logo_url = logo_url
              where id = ACAD_A returning 1)
  select count(*) into n from u;
  b := (n = 0);
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  with u as (update public.academies set secondary_colour = secondary_colour where id = ACAD_A returning 1)
  select count(*) into n from u;
  b := b and (n = 0);
  perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
  with u as (update public.academies set secondary_colour = secondary_colour where id = ACAD_A returning 1)
  select count(*) into n from u;
  b2 := (n = 1);
  execute 'reset role';
  insert into rls_results values (112,'a club''s colours and logo: its owner can change them; its coach and its families cannot',
    case when b and b2 then 'PASS' else 'FAIL (coach and parent refused '||b||', owner allowed '||b2||')' end);

  -- 113. Appearance is a person's own: they can change theirs, and nobody
  -- else's.
  perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  with u as (update public.profiles set appearance = appearance, colour_mode = colour_mode where id = PARENT returning 1)
  select count(*) into n from u;
  b := (n = 1);
  with u as (update public.profiles set appearance = appearance where id = MARCUS returning 1)
  select count(*) into n from u;
  b2 := (n = 0);
  execute 'reset role';
  insert into rls_results values (113,'a parent can change their own appearance and nobody else''s',
    case when b and b2 then 'PASS' else 'FAIL (own allowed '||b||', another refused '||b2||')' end);

  -- 0211. A child is counted once. Two guardians answer the same game
  -- differently (yes an hour ago, maybe now): the coach's tally counts the
  -- child once, as their latest answer, and the availability grid agrees.
  -- 114.
  select pg.player_id, min(pg.profile_id::text)::uuid, max(pg.profile_id::text)::uuid
    into v_kid, v_g1, v_g2
    from public.player_guardians pg
    join public.players pl on pl.id = pg.player_id and pl.team_id = '00000000-0000-0000-0000-0000000d0008'
   group by pg.player_id having count(*) >= 2 limit 1;
  if v_kid is null then
    insert into rls_results values (114, 'a child with two guardians is counted once', 'SKIP (no U8 child with two guardians in the seed)');
  else
    insert into public.events (academy_id, team_id, type, title, starts_at, ends_at)
      values (ACAD_A, '00000000-0000-0000-0000-0000000d0008', 'match', 'rls probe 114', now() + interval '3 days', now() + interval '3 days 1 hour')
      returning id into v_ev114;
    insert into public.event_rsvps (academy_id, event_id, profile_id, player_id, status, updated_at)
      values (ACAD_A, v_ev114, v_g1, v_kid, 'yes', now() - interval '1 hour'),
             (ACAD_A, v_ev114, v_g2, v_kid, 'maybe', now());
    select count(*) into v_roster from public.players where team_id = '00000000-0000-0000-0000-0000000d0008';
    perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
    execute 'set local role authenticated';
    select s.going, s.maybe, s.going + s.maybe + s.out_count + s.no_reply into v_going, v_maybe, v_total
      from public.event_rsvp_summary(v_ev114) s;
    begin
      v_grid := public.availability_grid('00000000-0000-0000-0000-0000000d0008', 4, 0);
    exception when others then
      v_grid := jsonb_build_object('refused', sqlerrm);
    end;
    execute 'reset role';
    b := v_going = 0 and v_maybe = 1 and v_total = v_roster;
    b2 := coalesce((select (x->>'going')::int from jsonb_array_elements(v_grid->'events') x where x->>'id' = v_ev114::text), -1) = 0;
    delete from public.events where id = v_ev114;
    insert into rls_results values (114, 'a child with two guardians is counted once, as their latest answer (tally and grid)',
      case when b and b2 then 'PASS' else 'FAIL (tally going '||v_going||' maybe '||v_maybe||' total '||v_total||' of '||v_roster||'; grid ok '||b2||coalesce(' — grid refused: '||(v_grid->>'refused'), '')||')' end);
  end if;

  -- 0213. A competition's Notices (Joey, 5 Nov 2026). In SPL Season 3 the
  -- league is COACH (who owns the SPL's organisation); NRIFA's U8 and Ravens'
  -- U8 are entered, so PARENT (Sam) and OUTSIDER (a Ravens U8 parent) are
  -- families in it, MARCUS and Ravens' U8 coach are club staff. NRIFA's own
  -- Spring Gala Day has NRIFA's teams and no Ravens team.
  declare
    RAVENS_COACH constant uuid := '00000000-0000-0000-0000-0000000000c1';
    v_spl uuid; v_gala uuid; v_nch uuid; v_gch uuid; v_norg uuid; v_gorg uuid;
    v_all uuid; v_staff uuid; v_gmsg uuid;
    s_all int; s_staff int; m_all int; m_staff int; o_all int; o_staff int; rc_staff int; o_gala int; p_gala int;
  begin
    select id into v_spl from public.competitions where name = 'SPL Season 3' limit 1;
    select id into v_gala from public.competitions where name = 'Spring Gala Day' limit 1;
    select id, academy_id into v_nch, v_norg from public.channels where type = 'notices' and competition_id = v_spl;
    select id, academy_id into v_gch, v_gorg from public.channels where type = 'notices' and competition_id = v_gala;

    if v_nch is null or v_gch is null then
      insert into rls_results values (115, 'every competition has its Notices', 'FAIL (SPL '||coalesce(v_nch::text,'none')||', Gala '||coalesce(v_gch::text,'none')||')');
    else
      insert into rls_results values (115, 'every competition has its Notices',
        case when (select count(*) from public.competitions c
                    where not exists (select 1 from public.channels ch where ch.type = 'notices' and ch.competition_id = c.id)) = 0
             then 'PASS' else 'FAIL (a competition without Notices)' end);

      -- The league posts one of each, and one in the Gala.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.messages (academy_id, channel_id, sender_id, body, audience)
      values (v_norg, v_nch, COACH, 'RLS notice: everyone', 'everyone') returning id into v_all;
      insert into public.messages (academy_id, channel_id, sender_id, body, audience)
      values (v_norg, v_nch, COACH, 'RLS notice: club staff', 'club_staff') returning id into v_staff;
      insert into public.messages (academy_id, channel_id, sender_id, body, audience)
      values (v_gorg, v_gch, COACH, 'RLS notice: the gala', 'everyone') returning id into v_gmsg;
      execute 'reset role';

      -- 116. Everyone in the competition reads it; club staff only is club staff only.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into s_all from public.messages where id = v_all;
      select count(*) into s_staff from public.messages where id = v_staff;
      select count(*) into p_gala from public.messages where id = v_gmsg;
      -- And through the chat screen's own reader, which runs as its definer.
      select s_staff + count(*) into s_staff from public.channel_messages(v_nch, null, 100) cm where cm.id = v_staff;
      select s_all * (select count(*) from public.channel_messages(v_nch, null, 100) cm where cm.id = v_all) into s_all;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into m_all from public.messages where id = v_all;
      select count(*) into m_staff from public.messages where id = v_staff;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into o_all from public.messages where id = v_all;
      select count(*) into o_staff from public.messages where id = v_staff;
      select count(*) into o_gala from public.messages where id = v_gmsg;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',RAVENS_COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into rc_staff from public.messages where id = v_staff;
      execute 'reset role';
      insert into rls_results values (116, 'a notice reaches everyone in its competition — families of both clubs, club staff — and club staff only reaches staff only',
        case when s_all = 1 and s_staff = 0 and m_all = 1 and m_staff = 1 and o_all = 1 and o_staff = 0 and rc_staff = 1 and p_gala = 1
             then 'PASS'
             else 'FAIL (Sam '||s_all||'/'||s_staff||', Marcus '||m_all||'/'||m_staff||', Ravens parent '||o_all||'/'||o_staff||', Ravens coach staff '||rc_staff||', Sam gala '||p_gala||')' end);
      -- 117. And nobody outside it: the Ravens parent is in the SPL, not in NRIFA's gala.
      insert into rls_results values (117, 'a notice reaches only that competition''s people',
        case when o_gala = 0 then 'PASS' else 'FAIL (a Ravens parent reads the NRIFA gala''s notice)' end);

      -- 118. A club cannot post: not its coach, not the other club's coach, not a parent.
      b := true;
      foreach v_kid in array array[MARCUS, RAVENS_COACH, PARENT] loop
        perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
        execute 'set local role authenticated';
        begin
          insert into public.messages (academy_id, channel_id, sender_id, body)
          values (v_norg, v_nch, v_kid, 'RLS notice: a club tries');
          b := false;
        exception when others then null;
        end;
        execute 'reset role';
      end loop;
      -- Nor in the organiser's own gala, as one of its coaches.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        insert into public.messages (academy_id, channel_id, sender_id, body)
        values (v_gorg, v_gch, MARCUS, 'RLS notice: a club tries');
        b := false;
      exception when others then null;
      end;
      execute 'reset role';
      insert into rls_results values (118, 'only the league posts in a competition''s Notices (no club coach, no parent)',
        case when b then 'PASS' else 'FAIL' end);

      -- 119. Nobody sees who else is in it: no member rows to read, none can
      -- be added (even by the league), no reactions, no replies.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into n from public.channel_members where channel_id = v_nch;
      b := n = 0;
      begin
        insert into public.channel_members (academy_id, channel_id, profile_id, role)
        values (v_norg, v_nch, OUTSIDER, 'member');
        b := false;
      exception when others then null;
      end;
      begin
        insert into public.messages (academy_id, channel_id, sender_id, body, reply_to_id)
        values (v_norg, v_nch, COACH, 'RLS notice: a reply', v_all);
        b := false;
      exception when others then null;
      end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        insert into public.message_reactions (message_id, profile_id, emoji) values (v_all, PARENT, '🎉');
        b := false;
      exception when others then null;
      end;
      select count(*) into n from jsonb_array_elements(public.channel_mentionables(v_nch));
      b := b and n = 0;
      execute 'reset role';
      insert into rls_results values (119, 'nobody in a competition''s Notices can see anybody else in them (no members, mentions, reactions or replies)',
        case when b then 'PASS' else 'FAIL' end);

      -- 120. Seen by: the league gets counts, never names; nobody else gets anything.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select coalesce(sum(r.total), 0) into n from public.notices_reach(v_nch, array[v_all, v_staff]) r;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into foreign_rows from public.notices_reach(v_nch, array[v_all, v_staff]);
      execute 'reset role';
      insert into rls_results values (120, 'seen-by on a notice is a count, for the league only',
        case when n > 0 and foreign_rows = 0 then 'PASS' else 'FAIL (league total '||n||', a club coach got '||foreign_rows||' rows)' end);

      -- 121. The per-person rule and the everyone-at-once rule agree, for
      -- every member of the clubs involved.
      select count(*) into n
        from (select distinct am.profile_id from public.academy_members am
               where am.academy_id in (ACAD_A, ACAD_B, v_norg)) people
       where app_private.notices_standing(v_spl, people.profile_id) is distinct from
             (select np.standing from app_private.notices_people(v_spl) np where np.profile_id = people.profile_id);
      insert into rls_results values (121, 'who is in a competition''s Notices is the same answer one at a time and all at once',
        case when n = 0 then 'PASS' else 'FAIL ('||n||' disagree)' end);

      -- 122. The push follows the audience: club staff only buzzes no parent.
      select count(*) into s_staff from public.notification_queue where dedupe_key = v_staff::text || ':' || PARENT::text;
      select count(*) into m_staff from public.notification_queue where dedupe_key = v_staff::text || ':' || MARCUS::text;
      select count(*) into s_all from public.notification_queue where dedupe_key = v_all::text || ':' || PARENT::text;
      insert into rls_results values (122, 'a notice''s push goes to whom it is for (everyone: Sam; club staff: Marcus, not Sam)',
        case when s_all = 1 and m_staff = 1 and s_staff = 0 then 'PASS'
             else 'FAIL (Sam everyone '||s_all||', Marcus staff '||m_staff||', Sam staff '||s_staff||')' end);

      -- 123. The league cannot open its Notices up, delete them, or make another.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b := true;
      begin
        update public.channels set posting_mode = 'open' where id = v_nch;
        b := false;
      exception when others then null;
      end;
      delete from public.channels where id = v_nch;
      get diagnostics n = row_count;
      b := b and n = 0;
      begin
        insert into public.channels (academy_id, type, competition_id, name, posting_mode)
        values (v_norg, 'notices', v_spl, 'Another notices', 'hosts_only');
        b := false;
      exception when others then null;
      end;
      execute 'reset role';
      insert into rls_results values (123, 'a competition''s Notices stay one-way: not opened up, deleted or duplicated by hand',
        case when b then 'PASS' else 'FAIL' end);

      delete from public.notification_queue
       where payload->>'message_id' in (v_all::text, v_staff::text, v_gmsg::text);
      delete from public.messages where id in (v_all, v_staff, v_gmsg);
      delete from public.messages where body = 'RLS notice: a club tries';
    end if;
  end;

  -- 0214. Every account has an email — and nobody sees anybody else's but
  -- their own organisation's owners and admins.
  declare
    LEAGUE_OWNER constant uuid := '00000000-0000-0000-0000-0000000000e1';
    had_sam bool; had_marcus bool; had_out bool; v_j jsonb; r126 text; v_out public.account_emails;
  begin
    had_sam := exists (select 1 from public.account_emails where profile_id = PARENT);
    had_marcus := exists (select 1 from public.account_emails where profile_id = MARCUS);
    select * into v_out from public.account_emails where profile_id = OUTSIDER;
    had_out := v_out.profile_id is not null;
    insert into public.account_emails (profile_id, email) values (PARENT, 'sam.rls-probe@example.com') on conflict do nothing;
    insert into public.account_emails (profile_id, email) values (MARCUS, 'marcus.rls-probe@example.com') on conflict do nothing;

    -- 124. Your own, and nobody else's.
    perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.account_emails where profile_id = PARENT;
    select count(*) into foreign_rows from public.account_emails where profile_id <> PARENT;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub',LEAGUE_OWNER,'role','authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_total from public.account_emails where profile_id in (PARENT, MARCUS);
    execute 'reset role';
    insert into rls_results values (124, 'a person reads their own email and nobody else''s (a league reads none)',
      case when n = 1 and foreign_rows = 0 and v_total = 0 then 'PASS'
           else 'FAIL (own '||n||', others '||foreign_rows||', league '||v_total||')' end);

    -- 125. Staff see their own members' emails, only: NRIFA's owner sees Sam's;
    -- not Ravens'; NRIFA's coach, Ravens' coach and the league see none of NRIFA's.
    perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.member_emails(ACAD_A) where profile_id = PARENT;
    b := false;
    begin perform * from public.member_emails(ACAD_B); exception when others then b := true; end;
    execute 'reset role';
    b2 := true;
    foreach v_kid in array array[MARCUS, '00000000-0000-0000-0000-0000000000c1'::uuid, LEAGUE_OWNER] loop
      perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        perform * from public.member_emails(ACAD_A);
        b2 := false;
      exception when others then null;
      end;
      execute 'reset role';
    end loop;
    insert into rls_results values (125, 'staff see emails only for their own members (no club''s coach, other club or league)',
      case when n = 1 and b and b2 then 'PASS' else 'FAIL (own members '||n||', other club refused '||b||', others refused '||b2||')' end);

    -- 126–127. The news opt-in starts off and is only ever what was ticked,
    -- with a record of each change; a placeholder address is refused.
    perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
    execute 'set local role authenticated';
    v_j := public.set_my_email('outsider.rls-probe@example.com');
    r126 := case when (v_j->>'news')::boolean is false then 'off' else 'on' end;
    v_j := public.set_my_news(true);
    r126 := r126 || ',' || case when (v_j->>'news')::boolean then 'on' else 'off' end;
    v_j := public.set_my_news(false);
    r126 := r126 || ',' || case when (v_j->>'news')::boolean then 'on' else 'off' end;
    b := false;
    begin perform public.set_my_email('p61400000099@squadroom.invalid'); exception when others then b := true; end;
    b2 := false;
    begin perform public.set_my_email('not an email'); exception when others then b2 := true; end;
    execute 'reset role';
    select count(*) into n from public.news_consents where profile_id = OUTSIDER and email = 'outsider.rls-probe@example.com';
    insert into rls_results values (126, 'the news opt-in defaults to off, and each yes and no is kept with its time',
      case when r126 = 'off,on,off' and n = 2 then 'PASS' else 'FAIL ('||r126||', '||n||' records)' end);
    insert into rls_results values (127, 'an address nobody reads, or no address at all, is refused',
      case when b and b2 then 'PASS' else 'FAIL' end);

    -- 128. The addresses for emailing a notice are the server's alone.
    insert into rls_results values (128, 'a signed-in person cannot ask for a notice''s email list',
      case when not has_function_privilege('authenticated', 'public.notice_email_recipients(uuid)', 'execute')
            and not has_function_privilege('anon', 'public.notice_email_recipients(uuid)', 'execute')
           then 'PASS' else 'FAIL' end);

    -- 129. And no email rides on a profile, which every clubmate can read.
    select count(*) into n from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name ilike '%email%';
    select count(*) into foreign_rows from pg_policies where schemaname = 'public' and tablename = 'account_emails';
    insert into rls_results values (129, 'no email on profiles; account_emails has one policy, your own',
      case when n = 0 and foreign_rows = 1 then 'PASS' else 'FAIL (profile email columns '||n||', policies '||foreign_rows||')' end);

    delete from public.news_consents where email = 'outsider.rls-probe@example.com';
    if had_out then
      update public.account_emails
         set email = v_out.email, verified_at = v_out.verified_at, news_opt_in_at = v_out.news_opt_in_at
       where profile_id = OUTSIDER;
    else
      delete from public.account_emails where profile_id = OUTSIDER;
    end if;
    if not had_sam then delete from public.account_emails where profile_id = PARENT; end if;
    if not had_marcus then delete from public.account_emails where profile_id = MARCUS; end if;
  end;

  -- 0215. A teenager's login, with a parent's yes. Probed inside a block that
  -- rolls itself back: the verdicts are kept, the memberships are not.
  declare
    LEO constant uuid := '00000000-0000-0000-0000-0000000e0001';
    U12 constant uuid := '00000000-0000-0000-0000-0000000d0012';
    v_teen uuid; r130 text; r131 text; r132 text; r133 text;
  begin
    begin
      -- 130. An under-13 cannot have a login, by invitation or by linking.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b := false;
      begin perform public.invite_player_login(LEO, 'leo.rls-probe@example.com'); exception when others then b := true; end;
      execute 'reset role';
      b2 := false;
      begin update public.players set profile_id = OUTSIDER where id = LEO; exception when others then b2 := true; end;
      r130 := case when b and b2 then 'PASS' else 'FAIL (invite refused '||b||', link refused '||b2||')' end;

      -- A fourteen-year-old in U12, Sam their guardian.
      insert into public.players (academy_id, team_id, full_name, dob)
      values (ACAD_A, U12, 'RLS Probe Teen', (current_date - interval '14 years')::date)
      returning id into v_teen;
      insert into public.player_guardians (academy_id, player_id, profile_id, relationship, is_primary)
      values (ACAD_A, v_teen, PARENT, 'parent', true);

      -- 132. Their login needs their own address, not the parent's.
      insert into public.account_emails (profile_id, email) values (PARENT, 'sam.rls-probe@example.com') on conflict do nothing;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b := false;
      begin perform public.invite_player_login(v_teen, (select email from public.account_emails where profile_id = PARENT)); exception when others then b := true; end;
      perform public.invite_player_login(v_teen, 'teen.rls-probe@example.com');
      execute 'reset role';
      r132 := case when b then 'PASS' else 'FAIL' end;

      -- 133. Nobody but a guardian invites or approves: not a stranger, not the coach.
      b := true;
      foreach v_kid in array array[OUTSIDER, MARCUS] loop
        perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
        execute 'set local role authenticated';
        begin perform public.invite_player_login(v_teen, 'someone.rls-probe@example.com'); b := false; exception when others then null; end;
        begin perform public.decide_player_login(v_teen, true); b := false; exception when others then null; end;
        execute 'reset role';
      end loop;
      r133 := case when b then 'PASS' else 'FAIL' end;

      -- 131. The teenager signs in (OUTSIDER plays the part) and WAITS: no
      -- membership, no link, no squad place until Sam says yes — and none
      -- can be made by hand meanwhile. Then yes, and they are in.
      update public.player_logins set profile_id = OUTSIDER, status = 'waiting', claimed_at = now() where player_id = v_teen;
      select count(*) into n from public.academy_members where academy_id = ACAD_A and profile_id = OUTSIDER and role = 'player';
      b := false;
      begin update public.players set profile_id = OUTSIDER where id = v_teen; exception when others then b := true; end;
      b2 := false;
      begin insert into public.team_members (academy_id, team_id, profile_id, role) values (ACAD_A, U12, OUTSIDER, 'player');
      exception when others then b2 := true; end;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.decide_player_login(v_teen, true);
      execute 'reset role';
      select count(*) into v_total from public.players where id = v_teen and profile_id = OUTSIDER;
      select count(*) into foreign_rows from public.team_members where team_id = U12 and profile_id = OUTSIDER and role = 'player';
      r131 := case when n = 0 and b and b2 and v_total = 1 and foreign_rows = 1 then 'PASS'
                   else 'FAIL (member before '||n||', link refused '||b||', squad refused '||b2||', linked after '||v_total||', in squad after '||foreign_rows||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r130 := coalesce(r130, 'FAIL (stopped: '||sqlerrm||')');
        r131 := coalesce(r131, 'FAIL (stopped: '||sqlerrm||')');
        r132 := coalesce(r132, 'FAIL (stopped: '||sqlerrm||')');
        r133 := coalesce(r133, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (130, 'an under-13 cannot get a login, by invitation or by linking', r130);
    insert into rls_results values (131, 'a 13-and-over login waits for a parent''s approval, and nothing can be linked meanwhile', r131);
    insert into rls_results values (132, 'a child''s login needs their own email, not the parent''s', r132);
    insert into rls_results values (133, 'only a guardian invites or approves a child''s login', r133);
  end;

  -- 0218. A score tap sent twice — its answer lost to the signal — counts
  -- once, and a replayed kick-off is not refused. Rolled back, like 130–133.
  declare r134 text; v_ev134 uuid;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, MARCUS, 'wwcc', 'RLS134', 'cleared', current_date + 300, COACH) on conflict do nothing;
      insert into public.events (academy_id, team_id, type, title, opponent, starts_at, ends_at)
      values (ACAD_A, '00000000-0000-0000-0000-0000000d0008', 'match', 'RLS 134', 'Probe', now() - interval '20 minutes', now() + interval '40 minutes')
      returning id into v_ev134;
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.live_tick(v_ev134, 'kick_off', p_client_id => 'bbbbbbbb-0000-0000-0000-000000000134');
      perform public.live_tick(v_ev134, 'kick_off', p_client_id => 'bbbbbbbb-0000-0000-0000-000000000134');
      perform public.live_tick(v_ev134, 'goal_for', p_client_id => 'bbbbbbbb-0000-0000-0000-000000001340');
      perform public.live_tick(v_ev134, 'goal_for', p_client_id => 'bbbbbbbb-0000-0000-0000-000000001340');
      execute 'reset role';
      select case when count(*) filter (where kind = 'goal_for') = 1 and count(*) filter (where kind = 'kick_off') = 1
                  then 'PASS' else 'FAIL ('||count(*)||' ticks)' end
        into r134 from public.event_ticker where event_id = v_ev134;
      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then r134 := 'FAIL (stopped: '||sqlerrm||')'; end if;
    end;
    execute 'reset role';
    insert into rls_results values (134, 'a score tap sent twice counts once, and a replayed kick-off is not refused', r134);
  end;

  -- 0221. Last season's players are offered their places. Rolled back, like
  -- 130–134: a squad of next season rolled from U8, its program for four,
  -- with Leo and Zoe (Sam's) and Arjun on it, and Mila already registered.
  declare
    LEO   constant uuid := '00000000-0000-0000-0000-0000000e0001';
    ARJUN constant uuid := '00000000-0000-0000-0000-0000000e0002';
    MILA  constant uuid := '00000000-0000-0000-0000-0000000e0003';
    HANA  constant uuid := '00000000-0000-0000-0000-0000000e0004';
    ZOE   constant uuid := '00000000-0000-0000-0000-0000000e0006';
    ARJUN_PARENT constant uuid := '00000000-0000-0000-0000-0000000000b2';
    HANA_PARENT  constant uuid := '00000000-0000-0000-0000-0000000000b4';
    v_nx uuid; v_sp uuid; v_res jsonb; v_res2 jsonb; v_leo uuid; v_zoe uuid; v_arjun uuid; v_told int; v_want int;
    r135 text; r136 text; r137 text; r138 text; r139 text; r140 text;
  begin
    begin
      insert into public.teams (academy_id, name, age_group, season, status, capacity, rolled_from, created_by)
      values (ACAD_A, 'RLS Next U9', 'U9', 'RLS-next', 'active', 4, '00000000-0000-0000-0000-0000000d0008', COACH)
      returning id into v_nx;
      insert into public.programs (academy_id, name, kind, status, season, team_id, capacity, created_by)
      values (ACAD_A, 'RLS Next U9 — RLS-next season', 'squad', 'open', 'RLS-next', v_nx, 4, COACH)
      returning id into v_sp;
      update public.players set team_id = v_nx where id in (LEO, ZOE, ARJUN, MILA);
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status)
      values (ACAD_A, v_sp, MILA, COACH, 'approved');

      -- 135. Only staff offer them: not a parent, a coach who is not staff, or another club.
      b := true;
      foreach v_kid in array array[PARENT, MARCUS, OUTSIDER] loop
        perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
        execute 'set local role authenticated';
        begin perform public.offer_returning_places(ACAD_A, 'RLS-next', current_date + 10); b := false; exception when others then null; end;
        execute 'reset role';
      end loop;
      r135 := case when b then 'PASS' else 'FAIL' end;

      -- 136. The owner offers: Leo, Zoe and Arjun, not Mila; every guardian
      -- told once. Sent again with the same date, nobody is told twice.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.offer_returning_places(ACAD_A, 'RLS-next', current_date + 10);
      v_res2 := public.offer_returning_places(ACAD_A, 'RLS-next', current_date + 10);
      execute 'reset role';
      select count(*) into n from public.offers where squad_program_id = v_sp and kind = 'returning' and status = 'open';
      select id into v_leo from public.offers where squad_program_id = v_sp and player_id = LEO;
      select id into v_zoe from public.offers where squad_program_id = v_sp and player_id = ZOE;
      select id into v_arjun from public.offers where squad_program_id = v_sp and player_id = ARJUN;
      select count(*) into v_told from public.notification_queue
       where kind = 'offer' and payload->>'offer_id' in (v_leo::text, v_zoe::text, v_arjun::text);
      select count(*) into v_want from public.player_guardians where player_id in (LEO, ZOE, ARJUN);
      r136 := case when (v_res->>'offered')::int = 3 and (v_res->>'skipped')::int = 1 and n = 3
                         and (v_res2->>'offered')::int = 0 and (v_res2->>'unchanged')::int = 3
                         and v_want > 0 and v_told = v_want
                    then 'PASS'
                    else 'FAIL ('||v_res::text||' then '||v_res2::text||'; '||n||' open; told '||v_told||' of '||v_want||')' end;

      -- 137. An open offer holds its place: Mila's registration and three
      -- offers fill four, so a newcomer (Hana) is waitlisted — and Leo,
      -- offered, is accepted though the program is now for 2017 births.
      perform set_config('request.jwt.claims', json_build_object('sub',HANA_PARENT,'role','authenticated')::text, true);
      insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status)
      values (ACAD_A, v_sp, HANA, HANA_PARENT, 'pending');
      update public.programs set born_from_year = 2017, born_to_year = 2017 where id = v_sp;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.accept_offer(v_leo);
      execute 'reset role';
      r137 := case when (select status::text from public.program_registrations where program_id = v_sp and player_id = HANA) = 'waitlisted'
                     and (select status::text from public.program_registrations where program_id = v_sp and player_id = LEO) = 'approved'
                     and (select status::text from public.offers where id = v_leo) = 'accepted'
                     and v_res->>'waiting_for' is null
                    then 'PASS'
                    else 'FAIL (Hana '||coalesce((select status::text from public.program_registrations where program_id = v_sp and player_id = HANA), 'none')
                         ||', Leo '||coalesce((select status::text from public.program_registrations where program_id = v_sp and player_id = LEO), 'none')||', '||v_res::text||')' end;

      -- 138. Where PlayFootball comes first, accepting holds the place as
      -- pending for the club to confirm, and asks for no money yet.
      update public.programs set requires_official_rego = true where id = v_sp;
      update public.players set official_status = 'unknown' where id = ZOE;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.accept_offer(v_zoe);
      execute 'reset role';
      r138 := case when (select status::text from public.program_registrations where program_id = v_sp and player_id = ZOE) = 'pending'
                     and (select status::text from public.offers where id = v_zoe) = 'accepted'
                     and v_res->>'waiting_for' = 'playfootball' and v_res->>'payment_request_id' is null
                    then 'PASS' else 'FAIL ('||v_res::text||')' end;

      -- 139. Only the child's guardian answers (Sam cannot decline Arjun's),
      -- and a "no" takes the child off the squad and frees the place.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b := false;
      begin perform public.decline_offer(v_arjun); exception when others then b := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',ARJUN_PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.decline_offer(v_arjun);
      execute 'reset role';
      r139 := case when b and (select team_id from public.players where id = ARJUN) is null
                     and (select status::text from public.offers where id = v_arjun) = 'declined'
                     and app_private.program_spots_left(v_sp) = 1
                    then 'PASS'
                    else 'FAIL (Sam refused '||b||'; Arjun''s squad '||coalesce((select team_id::text from public.players where id = ARJUN), 'none')
                         ||'; places left '||coalesce(app_private.program_spots_left(v_sp)::text, 'null')||')' end;

      -- 140. An offer is from a trial or for a returning player — never
      -- neither, never both — and nobody writes one by hand.
      b := false;
      begin
        insert into public.offers (academy_id, kind, player_id, squad_program_id, expires_at)
        values (ACAD_A, 'trial', HANA, v_sp, now() + interval '1 day');
      exception when check_violation then b := true; end;
      b2 := false;
      begin
        insert into public.offers (academy_id, kind, trial_registration_id, player_id, squad_program_id, expires_at)
        values (ACAD_A, 'returning', (select id from public.program_registrations where program_id = v_sp and player_id = MILA),
                HANA, v_sp, now() + interval '1 day');
      exception when check_violation then b2 := true; end;
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      n := 0;
      begin
        insert into public.offers (academy_id, kind, player_id, squad_program_id, expires_at)
        values (ACAD_A, 'returning', HANA, v_sp, now() + interval '1 day');
        n := 1;
      exception when others then null; end;
      execute 'reset role';
      r140 := case when b and b2 and n = 0 then 'PASS'
                   else 'FAIL (trial with none refused '||b||', returning with one refused '||b2||', by hand '||n||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r135 := coalesce(r135, 'FAIL (stopped: '||sqlerrm||')');
        r136 := coalesce(r136, 'FAIL (stopped: '||sqlerrm||')');
        r137 := coalesce(r137, 'FAIL (stopped: '||sqlerrm||')');
        r138 := coalesce(r138, 'FAIL (stopped: '||sqlerrm||')');
        r139 := coalesce(r139, 'FAIL (stopped: '||sqlerrm||')');
        r140 := coalesce(r140, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (135, 'only staff offer next season''s places (not a parent, a coach, another club)', r135);
    insert into rls_results values (136, 'each returning child not yet registered is offered their place once, and their guardians told once', r136);
    insert into rls_results values (137, 'an open offer holds its place against a newcomer; the offered child is accepted outside the birth year', r137);
    insert into rls_results values (138, 'where PlayFootball comes first, an accepted offer holds the place as pending and asks no money', r138);
    insert into rls_results values (139, 'only the child''s guardian answers, and a "no" takes the child off the squad and frees the place', r139);
    insert into rls_results values (140, 'an offer is from a trial or for a returning player, and nobody writes one by hand', r140);
  end;

  -- 0223. The game in pictures. Rolled back, like 130–140: a U8 game that
  -- has been played, two photos on it, Marcus its coach, Sam a family in
  -- it, Ben Carter a family of other squads. (Adding through the bucket is
  -- test-match-photos': files are written through the Storage API.)
  declare
    U8    constant uuid := '00000000-0000-0000-0000-0000000d0008';
    OTHER constant uuid := '00000000-0000-0000-0000-0000000000b9';
    v_ev uuid; v_dir text; v_res jsonb; v_p1 uuid; v_p2 uuid; v_seen int; v_other int; v_told int;
    r141 text; r142 text; r143 text; r144 text; r145 text;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, MARCUS, 'wwcc', 'RLS141', 'cleared', current_date + 300, COACH) on conflict do nothing;
      insert into public.events (academy_id, team_id, type, title, opponent, starts_at, ends_at)
      values (ACAD_A, U8, 'match', 'RLS 141', 'Probe', now() - interval '3 hours', now() - interval '2 hours')
      returning id into v_ev;
      v_dir := ACAD_A::text || '/' || v_ev::text || '/';
      insert into public.event_photos (academy_id, event_id, storage_path, thumb_path, added_by)
      values (ACAD_A, v_ev, v_dir || 'a.jpg', v_dir || 'a.thumb.jpg', MARCUS) returning id into v_p1;
      insert into public.event_photos (academy_id, event_id, storage_path, thumb_path, added_by)
      values (ACAD_A, v_ev, v_dir || 'b.jpg', v_dir || 'b.thumb.jpg', MARCUS) returning id into v_p2;

      -- 141. The squad's family sees the game's photos; a family of other
      -- squads sees none, and cannot open the game's list.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_seen from public.event_photos where event_id = v_ev;
      v_res := public.match_photos(v_ev);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',OTHER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_other from public.event_photos where event_id = v_ev;
      b := false;
      begin perform public.match_photos(v_ev); exception when others then b := true; end;
      execute 'reset role';
      r141 := case when v_seen = 2 and jsonb_array_length(v_res -> 'photos') = 2 and not (v_res ->> 'can_add')::boolean
                         and v_other = 0 and b
                    then 'PASS' else 'FAIL (family sees '||v_seen||', other squad sees '||v_other||', other refused '||b||')' end;

      -- 142. Nobody writes a photo's row by hand, coach or family.
      n := 0;
      foreach v_kid in array array[MARCUS, PARENT] loop
        perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
        execute 'set local role authenticated';
        begin
          insert into public.event_photos (academy_id, event_id, storage_path, added_by) values (ACAD_A, v_ev, v_dir || 'by-hand.jpg', v_kid);
          n := n + 1;
        exception when others then null; end;
        begin
          update public.event_photos set hidden_at = null, hidden_by = null where id = v_p1;
          if found then n := n + 1; end if;
        exception when others then null; end;
        execute 'reset role';
      end loop;
      r142 := case when n = 0 then 'PASS' else 'FAIL ('||n||' written by hand)' end;

      -- 143. Only the squad's coach adds photos, only into the game's own
      -- folder, and only files that have uploaded.
      b := true;
      foreach v_kid in array array[PARENT, OTHER] loop
        perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
        execute 'set local role authenticated';
        begin perform public.add_match_photos(v_ev, jsonb_build_array(jsonb_build_object('path', v_dir || 'c.jpg'))); b := false;
        exception when others then null; end;
        execute 'reset role';
      end loop;
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b2 := false;
      begin perform public.add_match_photos(v_ev, jsonb_build_array(jsonb_build_object('path', ACAD_B::text || '/' || v_ev::text || '/c.jpg')));
      exception when others then b2 := (sqlerrm like '%this game''s folder%'); end;
      n := 0;
      begin perform public.add_match_photos(v_ev, jsonb_build_array(jsonb_build_object('path', v_dir || 'never-uploaded.jpg')));
      exception when others then n := case when sqlerrm like '%did not finish uploading%' then 1 else 0 end; end;
      execute 'reset role';
      r143 := case when b and b2 and n = 1 then 'PASS'
                   else 'FAIL (others refused '||b||', another folder refused '||b2||', a missing file refused '||(n = 1)||')' end;

      -- 144. Sam takes one down: gone for Sam at once, still there for the
      -- coach marked hidden, the coach told; only the coach puts it back.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.take_down_match_photo(v_p1);
      select count(*) into v_seen from public.event_photos where event_id = v_ev;
      b := app_private.may_see_match_photo(v_dir || 'a.jpg') or app_private.may_see_match_photo(v_dir || 'a.thumb.jpg');
      b2 := false;
      begin perform public.restore_match_photo(v_p1); exception when others then b2 := true; end;
      execute 'reset role';
      select count(*) into v_told from public.notification_queue
       where kind = 'photo_hidden' and payload->>'photo_id' = v_p1::text and profile_id = MARCUS;
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.match_photos(v_ev);
      n := case when app_private.may_see_match_photo(v_dir || 'a.jpg') then 1 else 0 end;
      perform public.restore_match_photo(v_p1);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_other from public.event_photos where event_id = v_ev;
      execute 'reset role';
      r144 := case when v_seen = 1 and not b and b2 and v_told = 1 and n = 1 and v_other = 2
                         and exists (select 1 from jsonb_array_elements(v_res -> 'photos') x where (x ->> 'id')::uuid = v_p1 and (x ->> 'hidden')::boolean)
                    then 'PASS'
                    else 'FAIL (Sam sees '||v_seen||' after, can still open it '||b||', Sam cannot restore '||b2||', coach told '||v_told
                         ||', coach sees it '||n||', back for Sam '||v_other||')' end;

      -- 145. The bucket is private, and its read rule is the row's.
      select count(*) into n from storage.buckets where id = 'match-photos' and not public;
      select count(*) into v_seen from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and policyname = 'match_photos_read'
         and qual like '%may_see_match_photo%';
      perform set_config('request.jwt.claims', json_build_object('sub',OTHER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b := app_private.may_see_match_photo(v_dir || 'b.jpg');
      execute 'reset role';
      r145 := case when n = 1 and v_seen = 1 and not b then 'PASS' else 'FAIL (private '||n||', rule '||v_seen||', other squad can open '||b||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r141 := coalesce(r141, 'FAIL (stopped: '||sqlerrm||')');
        r142 := coalesce(r142, 'FAIL (stopped: '||sqlerrm||')');
        r143 := coalesce(r143, 'FAIL (stopped: '||sqlerrm||')');
        r144 := coalesce(r144, 'FAIL (stopped: '||sqlerrm||')');
        r145 := coalesce(r145, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (141, 'a game''s photos: its squad''s families see them, other squads see none', r141);
    insert into rls_results values (142, 'nobody writes a photo''s row by hand, coach or family', r142);
    insert into rls_results values (143, 'only the squad''s coach adds photos, into the game''s own folder, of files that uploaded', r143);
    insert into rls_results values (144, 'a family takes a photo down at once; the coach still sees it, is told, and alone puts it back', r144);
    insert into rls_results values (145, 'the photos bucket is private and its read rule is the photo''s row', r145);
  end;

  -- 0224. Two steps means two steps. Rolled back: the owner and Marcus turn
  -- two-step on; the owner is also given a league role and platform admin.
  declare
    U8  constant uuid := '00000000-0000-0000-0000-0000000d0008';
    LEO constant uuid := '00000000-0000-0000-0000-0000000e0001';
    s_before boolean; s_weak boolean; s_strong boolean; m_weak boolean; refused boolean;
    c_weak boolean; c_strong boolean; l_weak int; l_strong int; p_weak boolean; p_strong boolean; g_sam boolean; s_sam boolean;
    r146 text; r147 text; r148 text; r149 text;
  begin
    begin
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      s_before := coalesce(app_private.is_academy_staff(ACAD_A), false);
      execute 'reset role';
      insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
      values (gen_random_uuid(), COACH, 'rls-probe-owner', 'totp', 'verified', now(), now()),
             (gen_random_uuid(), MARCUS, 'rls-probe-coach', 'totp', 'verified', now(), now());
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, MARCUS, 'wwcc', 'RLS146', 'cleared', current_date + 300, COACH) on conflict do nothing;
      insert into public.league_roles (academy_id, profile_id, role) values (ACAD_A, COACH, 'competition_manager');
      insert into public.platform_admins (profile_id, note) values (COACH, 'rls probe') on conflict do nothing;

      -- 146/147. The owner, two-step on, password only (aal1): no staff or
      -- coaching powers, a staff-only function refuses — still a member.
      -- With the second step (aal2): staff again.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      s_weak := coalesce(app_private.is_academy_staff(ACAD_A), false) or coalesce(app_private.is_academy_coach(ACAD_A), false);
      refused := false;
      begin perform public.rollover_report(ACAD_A, '2026'); exception when others then refused := true; end;
      m_weak := coalesce(app_private.is_academy_member(ACAD_A), false);
      select cardinality(app_private.league_roles_of(ACAD_A)) into l_weak;
      p_weak := coalesce(app_private.is_platform_admin(), false);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated','aal','aal2')::text, true);
      execute 'set local role authenticated';
      s_strong := coalesce(app_private.is_academy_staff(ACAD_A), false);
      select cardinality(app_private.league_roles_of(ACAD_A)) into l_strong;
      p_strong := coalesce(app_private.is_platform_admin(), false);
      execute 'reset role';
      r146 := case when s_before and not s_weak and refused and s_strong then 'PASS'
                   else 'FAIL (staff before '||s_before||', with a password only '||s_weak||', refused '||refused||', with both steps '||s_strong||')' end;
      r147 := case when m_weak then 'PASS' else 'FAIL (not even a member)' end;

      -- 148. Marcus coaches U8 with two-step on: not its coach on a password
      -- alone, its coach with the second step.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      c_weak := coalesce(app_private.is_team_coach(U8), false);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated','aal','aal2')::text, true);
      execute 'set local role authenticated';
      c_strong := coalesce(app_private.is_team_coach(U8), false);
      execute 'reset role';
      r148 := case when not c_weak and c_strong then 'PASS' else 'FAIL (password only '||c_weak||', both steps '||c_strong||')' end;

      -- 149. League roles and platform admin the same way; and someone who
      -- never turned it on (Sam, password only) is untouched.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      g_sam := coalesce(app_private.is_guardian_of(LEO), false);
      s_sam := coalesce(app_private.is_academy_member(ACAD_A), false);
      execute 'reset role';
      r149 := case when l_weak = 0 and l_strong = 1 and not p_weak and p_strong and g_sam and s_sam then 'PASS'
                   else 'FAIL (league roles '||l_weak||'/'||l_strong||', platform '||p_weak||'/'||p_strong||', Sam still Leo''s guardian '||g_sam||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r146 := coalesce(r146, 'FAIL (stopped: '||sqlerrm||')');
        r147 := coalesce(r147, 'FAIL (stopped: '||sqlerrm||')');
        r148 := coalesce(r148, 'FAIL (stopped: '||sqlerrm||')');
        r149 := coalesce(r149, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (146, 'an owner with two-step on has no staff powers on a password alone, and has them with both steps', r146);
    insert into rls_results values (147, 'on a password alone they are still a member', r147);
    insert into rls_results values (148, 'a squad''s coach with two-step on is not its coach on a password alone', r148);
    insert into rls_results values (149, 'league roles and platform admin need both steps too; nobody without two-step is touched', r149);
  end;

  -- 0225. Helpers wanted. Rolled back: a U8 game three days out, Marcus its
  -- coach, Sam and Hana's parent families in it, Ben Carter a family of
  -- other squads, OUTSIDER another club.
  declare
    U8    constant uuid := '00000000-0000-0000-0000-0000000d0008';
    OTHER constant uuid := '00000000-0000-0000-0000-0000000000b9';
    HANA_PARENT constant uuid := '00000000-0000-0000-0000-0000000000b4';
    v_ev uuid; v_res jsonb; v_canteen uuid; v_lines uuid; v_at timestamptz; v_want timestamptz;
    v_sam int; v_other int; v_out int; v_full boolean; v_asked int; v_ben int; v_again boolean; v_told int;
    r150 text; r151 text; r152 text; r153 text; r154 text;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, MARCUS, 'wwcc', 'RLS150', 'cleared', current_date + 300, COACH) on conflict do nothing;
      insert into public.events (academy_id, team_id, type, title, opponent, starts_at, ends_at)
      values (ACAD_A, U8, 'match', 'RLS 150', 'Probe',
              ((((now() at time zone 'Australia/Sydney')::date + 3) + time '10:00')::timestamp at time zone 'Australia/Sydney'),
              ((((now() at time zone 'Australia/Sydney')::date + 3) + time '11:00')::timestamp at time zone 'Australia/Sydney'))
      returning id into v_ev;

      -- 151. Only the squad's coach sets the jobs; nobody writes them by hand.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b := false;
      begin perform public.set_event_jobs(v_ev, '[{"title":"Canteen"}]'::jsonb); exception when others then b := true; end;
      n := 0;
      begin insert into public.event_jobs (academy_id, event_id, title) values (ACAD_A, v_ev, 'By hand'); n := 1; exception when others then null; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.set_event_jobs(v_ev, '[{"title":"Canteen","start_time":"08:00","end_time":"10:00","spots":2},{"title":"Linesman","spots":1}]'::jsonb);
      execute 'reset role';
      select id into v_canteen from public.event_jobs where event_id = v_ev and title = 'Canteen';
      select id into v_lines from public.event_jobs where event_id = v_ev and title = 'Linesman';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      begin insert into public.event_job_helpers (job_id, academy_id, profile_id) values (v_lines, ACAD_A, PARENT); n := n + 1; exception when others then null; end;
      execute 'reset role';
      r151 := case when b and n = 0 and jsonb_array_length(v_res -> 'jobs') = 2 and (v_res ->> 'can_manage')::boolean
                         and (v_res -> 'jobs' -> 0 ->> 'time') = '8:00 am–10:00 am'
                    then 'PASS' else 'FAIL (parent refused '||b||', by hand '||n||', jobs '||coalesce(v_res::text, 'none')||')' end;

      -- 150. The squad's families see them; other squads and other clubs do not.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_sam from public.event_jobs where event_id = v_ev;
      v_res := public.event_helpers(v_ev);
      execute 'reset role';
      v_other := 0; v_out := 0; b := true;
      foreach v_kid in array array[OTHER, OUTSIDER] loop
        perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
        execute 'set local role authenticated';
        select count(*) into n from public.event_jobs where event_id = v_ev;
        v_other := v_other + n;
        select count(*) into n from public.event_job_helpers where job_id in (v_canteen, v_lines);
        v_out := v_out + n;
        begin perform public.event_helpers(v_ev); b := false; exception when others then null; end;
        execute 'reset role';
      end loop;
      r150 := case when v_sam = 2 and jsonb_array_length(v_res -> 'jobs') = 2 and not (v_res ->> 'can_manage')::boolean
                         and v_other = 0 and v_out = 0 and b
                    then 'PASS' else 'FAIL (Sam sees '||v_sam||', others see '||v_other||', others refused '||b||')' end;

      -- 152. Sam takes the linesman's flag: Hana's parent finds it full; Sam
      -- is reminded at 6 pm the evening before, the reminder moves with the
      -- game, and goes when the game is called off.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.help_with(v_lines);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HANA_PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_full := false;
      begin perform public.help_with(v_lines); exception when others then v_full := sqlerrm like '%is full%'; end;
      execute 'reset role';
      select scheduled_for into v_at from public.notification_queue
       where kind = 'helper_reminder' and profile_id = PARENT and payload->>'event_id' = v_ev::text and sent_at is null;
      v_want := ((((now() at time zone 'Australia/Sydney')::date + 2) + time '18:00')::timestamp at time zone 'Australia/Sydney');
      b := v_at = v_want;
      update public.events set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = v_ev;
      select scheduled_for into v_at from public.notification_queue
       where kind = 'helper_reminder' and profile_id = PARENT and payload->>'event_id' = v_ev::text and sent_at is null;
      b2 := v_at = ((((now() at time zone 'Australia/Sydney')::date + 3) + time '18:00')::timestamp at time zone 'Australia/Sydney');

      -- 153. "Ask for help": the squad's people, not other squads', not the
      -- coach; once in twelve hours; a parent cannot ask.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_asked := public.ask_for_helpers(v_ev);
      v_again := false;
      begin perform public.ask_for_helpers(v_ev); exception when others then v_again := true; end;
      execute 'reset role';
      select count(*) into v_ben from public.notification_queue where kind = 'helpers_wanted' and payload->>'event_id' = v_ev::text and profile_id in (OTHER, MARCUS);
      select count(*) into n from public.notification_queue where kind = 'helpers_wanted' and payload->>'event_id' = v_ev::text and profile_id = PARENT;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_told := 0;
      begin perform public.ask_for_helpers(v_ev); v_told := 1; exception when others then null; end;
      execute 'reset role';
      r153 := case when v_asked > 0 and n = 1 and v_ben = 0 and v_again and v_told = 0 then 'PASS'
                   else 'FAIL (asked '||v_asked||', Sam told '||n||', other squad or coach told '||v_ben||', twice refused '||v_again||', parent asked '||v_told||')' end;

      -- 154. The coach takes Sam off the flag: Sam is told, and Sam's
      -- reminder goes with it. Sam takes the canteen, the game comes forward
      -- to tomorrow, Sam drops out: the coach is told.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.stop_helping(v_lines, PARENT);
      execute 'reset role';
      select count(*) into v_told from public.notification_queue where kind = 'helper_changed' and profile_id = PARENT and payload->>'event_id' = v_ev::text;
      select count(*) into n from public.notification_queue where kind = 'helper_reminder' and profile_id = PARENT and payload->>'event_id' = v_ev::text and sent_at is null;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.help_with(v_canteen);
      execute 'reset role';
      update public.events set starts_at = now() + interval '30 hours', ends_at = now() + interval '31 hours' where id = v_ev;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.stop_helping(v_canteen);
      execute 'reset role';
      select count(*) into v_sam from public.notification_queue where kind = 'helper_changed' and profile_id = MARCUS and payload->>'event_id' = v_ev::text;
      r154 := case when v_told = 1 and n = 0 and v_sam = 1 then 'PASS'
                   else 'FAIL (Sam told '||v_told||', reminder left '||n||', coach told '||v_sam||')' end;

      -- 152, the last part: back three days out, Sam on the canteen, then
      -- called off — the reminder goes.
      update public.events
         set starts_at = ((((now() at time zone 'Australia/Sydney')::date + 3) + time '10:00')::timestamp at time zone 'Australia/Sydney'),
             ends_at = ((((now() at time zone 'Australia/Sydney')::date + 3) + time '11:00')::timestamp at time zone 'Australia/Sydney')
       where id = v_ev;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.help_with(v_canteen);
      execute 'reset role';
      select count(*) into v_other from public.notification_queue where kind = 'helper_reminder' and profile_id = PARENT and payload->>'event_id' = v_ev::text and sent_at is null;
      update public.events set cancelled_at = now() where id = v_ev;
      select count(*) into v_out from public.notification_queue where kind = 'helper_reminder' and profile_id = PARENT and payload->>'event_id' = v_ev::text and sent_at is null;
      r152 := case when v_full and b and b2 and v_other = 1 and v_out = 0 then 'PASS'
                   else 'FAIL (full refused '||v_full||', 6 pm the evening before '||b||', moved with the game '||b2||', queued '||v_other||', after calling off '||v_out||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r150 := coalesce(r150, 'FAIL (stopped: '||sqlerrm||')');
        r151 := coalesce(r151, 'FAIL (stopped: '||sqlerrm||')');
        r152 := coalesce(r152, 'FAIL (stopped: '||sqlerrm||')');
        r153 := coalesce(r153, 'FAIL (stopped: '||sqlerrm||')');
        r154 := coalesce(r154, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (150, 'a game''s helper jobs: its squad''s families see them, other squads and clubs do not', r150);
    insert into rls_results values (151, 'only the squad''s coach sets the jobs, and nobody writes them by hand', r151);
    insert into rls_results values (152, 'a full job refuses; the reminder is 6 pm the evening before, moves with the game, goes when it is called off', r152);
    insert into rls_results values (153, 'asking for help reaches the squad''s people only, once in twelve hours, and only the coach asks', r153);
    insert into rls_results values (154, 'taken off a job you are told; dropping out in the last two days tells the coach', r154);
  end;

  -- 0226. A bank payment clears. Rolled back: a fee for U8 due in three
  -- days, the program it belongs to with Leo registered, Leo's bank payment
  -- clearing, Zoe's not paid (both Sam's).
  declare
    U8  constant uuid := '00000000-0000-0000-0000-0000000d0008';
    LEO constant uuid := '00000000-0000-0000-0000-0000000e0001';
    ZOE constant uuid := '00000000-0000-0000-0000-0000000e0006';
    v_req uuid; v_prog uuid; v_reg uuid; v_pay uuid; v_q jsonb; v_wd2 jsonb;
    c0 int; c1 int; c2 int; v_owed_leo int; v_owed_zoe int; v_rem_leo int; v_rem_zoe int;
    v_vou boolean; v_wd boolean; v_bad boolean;
    r155 text; r156 text; r157 text;
  begin
    begin
      update public.players set team_id = U8 where id in (LEO, ZOE);
      update public.academies set fee_reminders = true where id = ACAD_A;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select coalesce((select (x->>'count')::int from jsonb_array_elements(public.needs_you(ACAD_A)) x where x->>'kind' = 'fees'), 0) into c0;
      execute 'reset role';
      insert into public.payment_requests (academy_id, team_id, title, amount_cents, due_on, created_by)
      values (ACAD_A, U8, 'RLS 155 fee', 5000, current_date + 3, COACH) returning id into v_req;
      insert into public.programs (academy_id, name, kind, status, season, team_id, payment_request_id, created_by)
      values (ACAD_A, 'RLS 155 program', 'squad', 'open', '2026', U8, v_req, COACH) returning id into v_prog;
      insert into public.vouchers (academy_id, code, label, kind, amount_cents, created_by)
      values (ACAD_A, 'RLS157', 'RLS probe', 'club', 1000, COACH);
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status)
      values (ACAD_A, v_prog, LEO, COACH, 'approved') returning id into v_reg;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select coalesce((select (x->>'count')::int from jsonb_array_elements(public.needs_you(ACAD_A)) x where x->>'kind' = 'fees'), 0) into c1;
      execute 'reset role';

      -- 155. A payment can be processing, and nothing made up.
      insert into public.payments (academy_id, request_id, profile_id, player_id, stripe_session_id, amount_cents, status)
      values (ACAD_A, v_req, PARENT, LEO, 'cs_rls155', 5000, 'processing') returning id into v_pay;
      v_bad := false;
      begin
        insert into public.payments (academy_id, request_id, profile_id, player_id, amount_cents, status)
        values (ACAD_A, v_req, PARENT, ZOE, 5000, 'cleared');
      exception when check_violation then v_bad := true; end;
      r155 := case when v_bad then 'PASS' else 'FAIL (a made-up status was accepted)' end;

      -- 156. Not owed while it clears: not on Sam's Home, not in who-owes,
      -- no reminder for Leo (Zoe's still comes), nothing outstanding on the
      -- quote and the part says it is clearing.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select coalesce((select (x->>'count')::int from jsonb_array_elements(public.needs_you(ACAD_A)) x where x->>'kind' = 'fees'), 0) into c2;
      v_q := public.quote_payment(v_req, LEO);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select coalesce(sum(f.outstanding_cents), 0) into v_owed_leo from public.outstanding_fees(ACAD_A) f where f.request_id = v_req and f.player_id = LEO;
      select coalesce(sum(f.outstanding_cents), 0) into v_owed_zoe from public.outstanding_fees(ACAD_A) f where f.request_id = v_req and f.player_id = ZOE;
      execute 'reset role';
      perform public.queue_fee_reminders();
      select count(*) into v_rem_leo from public.notification_queue q where q.kind = 'fee_due' and q.payload->>'request_id' = v_req::text and q.payload->>'player_id' = LEO::text;
      select count(*) into v_rem_zoe from public.notification_queue q where q.kind = 'fee_due' and q.payload->>'request_id' = v_req::text and q.payload->>'player_id' = ZOE::text;
      r156 := case when c1 = c0 + 2 and c2 = c0 + 1 and v_owed_leo = 0 and v_owed_zoe > 0 and v_rem_leo = 0 and v_rem_zoe = 1
                         and (v_q->>'outstanding_cents')::int = 0 and v_q->'schedule'->0->>'status' = 'processing'
                    then 'PASS'
                    else 'FAIL (Home '||c0||'/'||c1||'/'||c2||', owed Leo '||v_owed_leo||' Zoe '||v_owed_zoe||', reminders Leo '||v_rem_leo||' Zoe '||v_rem_zoe
                         ||', quote '||coalesce(v_q->>'outstanding_cents', 'null')||' '||coalesce(v_q->'schedule'->0->>'status', 'null')||')' end;

      -- 157. No voucher on money already sent; a withdrawal waits for it to
      -- clear, and goes through — with its refund — once it has.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_vou := false;
      begin perform public.redeem_voucher('RLS157', v_req, LEO); exception when others then v_vou := sqlerrm like '%already paid%'; end;
      v_wd := false;
      begin perform public.withdraw_registration(v_reg, 'rls probe'); exception when others then v_wd := sqlerrm like '%still clearing%'; end;
      execute 'reset role';
      update public.payments set status = 'paid', paid_at = now() where id = v_pay;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_wd2 := public.withdraw_registration(v_reg, 'rls probe');
      execute 'reset role';
      r157 := case when v_vou and v_wd and (v_wd2->>'refunds')::int = 1 then 'PASS'
                   else 'FAIL (voucher refused '||v_vou||', withdrawal waited '||v_wd||', then '||coalesce(v_wd2::text, 'null')||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r155 := coalesce(r155, 'FAIL (stopped: '||sqlerrm||')');
        r156 := coalesce(r156, 'FAIL (stopped: '||sqlerrm||')');
        r157 := coalesce(r157, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (155, 'a payment can be processing (a bank debit clearing), and no status is made up', r155);
    insert into rls_results values (156, 'a clearing fee is not owed: not on Home, not in who-owes, not reminded, nothing outstanding on the quote', r156);
    insert into rls_results values (157, 'no voucher on money already sent; a withdrawal waits for it to clear, then refunds', r157);
  end;

  -- 0227. Pay later, by a day. Rolled back: a fee for U8 due in ten days,
  -- Leo, Zoe and Hana on it, Zoe's paid.
  declare
    U8   constant uuid := '00000000-0000-0000-0000-0000000d0008';
    LEO  constant uuid := '00000000-0000-0000-0000-0000000e0001';
    ZOE  constant uuid := '00000000-0000-0000-0000-0000000e0006';
    HANA constant uuid := '00000000-0000-0000-0000-0000000e0004';
    HANA_PARENT constant uuid := '00000000-0000-0000-0000-0000000000b4';
    OTHER constant uuid := '00000000-0000-0000-0000-0000000000b9';
    v_req uuid; v_by date; v_hand int; v_too boolean; v_today boolean; v_paidfee boolean; v_notmine boolean;
    n_leo int; n_hana int; n_prom int; n_late int; v_regd date; v_owes date; v_mine date; v_read int;
    r158 text; r159 text; r160 text;
  begin
    begin
      update public.players set team_id = U8 where id in (LEO, ZOE, HANA);
      update public.academies set fee_reminders = true where id = ACAD_A;
      insert into public.payment_requests (academy_id, team_id, title, amount_cents, due_on, created_by)
      values (ACAD_A, U8, 'RLS 158 fee', 5000, current_date + 10, COACH) returning id into v_req;
      insert into public.payments (academy_id, request_id, profile_id, player_id, amount_cents, status, paid_at)
      values (ACAD_A, v_req, PARENT, ZOE, 5000, 'paid', now());

      -- 158. Sam names a day for Leo: not today, not three months out, not
      -- for someone else's child, not on a fee already paid, never by hand.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.promise_to_pay(v_req, LEO, current_date + 5);
      v_today := false;
      begin perform public.promise_to_pay(v_req, LEO, current_date); exception when others then v_today := true; end;
      v_too := false;
      begin perform public.promise_to_pay(v_req, LEO, current_date + 90); exception when others then v_too := true; end;
      v_paidfee := false;
      begin perform public.promise_to_pay(v_req, ZOE, current_date + 5); exception when others then v_paidfee := sqlerrm like '%nothing left%'; end;
      v_hand := 0;
      begin
        insert into public.payment_promises (academy_id, request_id, player_id, profile_id, by_date)
        values (ACAD_A, v_req, HANA, PARENT, current_date + 5);
        v_hand := 1;
      exception when others then null; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HANA_PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_notmine := false;
      begin perform public.promise_to_pay(v_req, LEO, current_date + 5); exception when others then v_notmine := (sqlstate = '42501'); end;
      execute 'reset role';
      select by_date into v_by from public.payment_promises where request_id = v_req and player_id = LEO;
      r158 := case when v_by = current_date + 5 and v_today and v_too and v_paidfee and v_hand = 0 and v_notmine then 'PASS'
                   else 'FAIL (kept '||coalesce(v_by::text, 'none')||', today refused '||v_today||', 90 days refused '||v_too
                        ||', paid fee refused '||v_paidfee||', by hand '||v_hand||', other parent refused '||v_notmine||')' end;

      -- 159. The chase holds until the day: due in three days, Hana's family
      -- is reminded and Sam is not; the day before Sam's day, Sam is told it
      -- is tomorrow; after it, unpaid, the overdue chase resumes.
      update public.payment_requests set due_on = current_date + 3 where id = v_req;
      perform public.queue_fee_reminders();
      select count(*) into n_leo from public.notification_queue q
       where q.kind in ('fee_due', 'fee_overdue') and q.payload->>'request_id' = v_req::text and q.payload->>'player_id' = LEO::text;
      select count(*) into n_hana from public.notification_queue q
       where q.kind = 'fee_due' and q.payload->>'request_id' = v_req::text and q.payload->>'player_id' = HANA::text;
      update public.payment_promises set by_date = current_date + 1 where request_id = v_req and player_id = LEO;
      perform public.queue_fee_reminders();
      select count(*) into n_prom from public.notification_queue q
       where q.kind = 'fee_due' and q.dedupe_key like 'promise:%' and q.payload->>'player_id' = LEO::text
         and q.profile_id = PARENT and q.title like '%by tomorrow%';
      update public.payment_promises set by_date = current_date - 1 where request_id = v_req and player_id = LEO;
      update public.payment_requests set due_on = current_date - 3 where id = v_req;
      perform public.queue_fee_reminders();
      select count(*) into n_late from public.notification_queue q
       where q.kind = 'fee_overdue' and q.payload->>'request_id' = v_req::text and q.payload->>'player_id' = LEO::text
         and q.profile_id = PARENT;
      r159 := case when n_leo = 0 and n_hana >= 1 and n_prom = 1 and n_late = 1 then 'PASS'
                   else 'FAIL (Leo chased while promised '||n_leo||', Hana reminded '||n_hana||', the day before '||n_prom||', after the day '||n_late||')' end;

      -- 160. The club sees the day beside the name (the register, who-owes),
      -- Sam sees it on the fee, and nobody else reads it.
      update public.payment_promises set by_date = current_date + 5 where request_id = v_req and player_id = LEO;
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select r.promised_by into v_regd from public.payment_register(v_req) r where r.player_id = LEO;
      select f.promised_by into v_owes from public.outstanding_fees(ACAD_A) f where f.request_id = v_req and f.player_id = LEO;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select m.promised_by into v_mine from public.my_payment_requests(ACAD_A) m where m.request_id = v_req and m.player_id = LEO;
      execute 'reset role';
      v_read := 0;
      foreach v_kid in array array[HANA_PARENT, OTHER, OUTSIDER] loop
        perform set_config('request.jwt.claims', json_build_object('sub',v_kid,'role','authenticated')::text, true);
        execute 'set local role authenticated';
        select v_read + count(*) into v_read from public.payment_promises where request_id = v_req;
        execute 'reset role';
      end loop;
      r160 := case when v_regd = current_date + 5 and v_owes = current_date + 5 and v_mine = current_date + 5 and v_read = 0 then 'PASS'
                   else 'FAIL (register '||coalesce(v_regd::text, 'none')||', who-owes '||coalesce(v_owes::text, 'none')
                        ||', Sam sees '||coalesce(v_mine::text, 'none')||', others read '||v_read||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r158 := coalesce(r158, 'FAIL (stopped: '||sqlerrm||')');
        r159 := coalesce(r159, 'FAIL (stopped: '||sqlerrm||')');
        r160 := coalesce(r160, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (158, 'a family names a day to pay by: their own child, from tomorrow, within sixty days, on a fee still owed, never by hand', r158);
    insert into rls_results values (159, 'the chase holds until the day, the family is reminded the day before, and after it the chase resumes', r159);
    insert into rls_results values (160, 'the club sees the day beside the name, the family on the fee, and nobody else', r160);
  end;

  -- 0228. The file says who leads. Rolled back: U8 is "NRFA U8" to the
  -- league; a file of four U8 teams, one game still to play, and a U9 game
  -- that came along with it.
  declare
    U8 constant uuid := '00000000-0000-0000-0000-0000000d0008';
    OTHER constant uuid := '00000000-0000-0000-0000-0000000000b9';
    v_season text; v_res jsonb; v_t jsonb; v_rows jsonb; v_n int; v_again jsonb;
    v_parent boolean; v_hand int; v_out int; v_outside boolean; v_other boolean;
    r161 text; r162 text; r163 text;
  begin
    begin
      update public.teams set external_ref = 'NRFA U8' where id = U8;
      select season into v_season from public.teams where id = U8;
      v_rows := jsonb_build_array(
        jsonb_build_object('round', '1', 'local_date', current_date - 14, 'home', 'NRFA U8', 'away', 'Hornsby U8', 'home_score', 2, 'away_score', 1, 'external_ref', 'RLS161-1'),
        jsonb_build_object('round', '1', 'local_date', current_date - 14, 'home', 'Mosman U8', 'away', 'Manly U8', 'home_score', 0, 'away_score', 0),
        jsonb_build_object('round', '2', 'local_date', current_date - 7, 'home', 'Hornsby U8', 'away', 'Mosman U8', 'home_score', 3, 'away_score', 0, 'external_ref', 'RLS161-3'),
        jsonb_build_object('round', '2', 'local_date', current_date - 7, 'home', 'Manly U8', 'away', 'NRFA U8', 'external_ref', 'RLS161-4'),
        jsonb_build_object('round', '2', 'local_date', current_date - 7, 'home', 'Hornsby U9', 'away', 'Mosman U9', 'home_score', 5, 'away_score', 5));

      -- 161. A parent cannot store them, nor anyone by hand; the coach can,
      -- and the same file again — with last week's score filled in — updates
      -- the game rather than doubling it.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_parent := false;
      begin perform public.store_imported_games(ACAD_A, v_season, v_rows); exception when others then v_parent := (sqlstate = '42501'); end;
      v_hand := 0;
      begin
        insert into public.imported_games (academy_id, season, local_date, home, away) values (ACAD_A, v_season, current_date, 'A', 'B');
        v_hand := 1;
      exception when others then null; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.store_imported_games(ACAD_A, v_season, v_rows);
      v_again := public.store_imported_games(ACAD_A, v_season,
                   v_rows || jsonb_build_array(jsonb_build_object('round', '2', 'local_date', current_date - 7, 'home', 'Manly U8', 'away', 'NRFA U8', 'home_score', 1, 'away_score', 4, 'external_ref', 'RLS161-4')));
      execute 'reset role';
      select count(*) into v_n from public.imported_games g where g.academy_id = ACAD_A and g.season = v_season and g.home like '% U_' ;
      r161 := case when v_parent and v_hand = 0 and (v_res->>'added')::int = 5 and (v_again->>'added')::int = 0 and (v_again->>'updated')::int = 6 and v_n = 5
                         and (select g.away_score from public.imported_games g where g.external_ref = 'RLS161-4') = 4
                    then 'PASS'
                    else 'FAIL (parent refused '||v_parent||', by hand '||v_hand||', first '||coalesce(v_res::text, 'null')||', again '||coalesce(v_again::text, 'null')||', rows '||v_n||')' end;

      -- 162. The U8 table, for Sam: the four U8 sides and not the U9s; the
      -- scores add up (NRFA 6 on +4, Hornsby 3, then Manly over Mosman on
      -- goals for with 1 point and −3 each); ours is marked.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_t := public.division_table(U8);
      execute 'reset role';
      r162 := case when jsonb_array_length(v_t -> 'rows') = 4
                         and (v_t -> 'rows' -> 0 ->> 'team') = 'NRFA U8' and (v_t -> 'rows' -> 0 ->> 'ours')::boolean
                         and (v_t -> 'rows' -> 0 ->> 'pts')::int = 6 and (v_t -> 'rows' -> 0 ->> 'gd')::int = 4
                         and (v_t -> 'rows' -> 1 ->> 'team') = 'Hornsby U8' and (v_t -> 'rows' -> 1 ->> 'pts')::int = 3
                         and (v_t -> 'rows' -> 2 ->> 'team') = 'Manly U8' and (v_t -> 'rows' -> 3 ->> 'team') = 'Mosman U8'
                         and (v_t ->> 'games')::int = 4
                         and not exists (select 1 from jsonb_array_elements(v_t -> 'rows') x where x ->> 'team' like '%U9')
                    then 'PASS' else 'FAIL ('||coalesce(v_t::text, 'null')||')' end;

      -- 163. Another club reads none of it and cannot ask for the table; a
      -- family of another squad at this club cannot ask for U8's.
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_out from public.imported_games where academy_id = ACAD_A;
      v_outside := false;
      begin perform public.division_table(U8); exception when others then v_outside := true; end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',OTHER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_other := false;
      begin perform public.division_table(U8); exception when others then v_other := true; end;
      execute 'reset role';
      r163 := case when v_out = 0 and v_outside and v_other then 'PASS'
                   else 'FAIL (other club reads '||v_out||', refused '||v_outside||', other squad refused '||v_other||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r161 := coalesce(r161, 'FAIL (stopped: '||sqlerrm||')');
        r162 := coalesce(r162, 'FAIL (stopped: '||sqlerrm||')');
        r163 := coalesce(r163, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (161, 'the file''s games are kept by the coach only, and a re-import updates a game rather than doubling it', r161);
    insert into rls_results values (162, 'the division table is the teams around ours, adding up 3/1/0 with goal difference, and not the other age group', r162);
    insert into rls_results values (163, 'another club reads none of it; only the squad''s own people ask for its table', r163);
  end;

  -- 0230. The league's share of each player. Rolled back: the competition
  -- NRIFA has entered with a squad, its organiser's owner, a levy of $12 a
  -- player for one division and $10 for the rest, a $20 payment.
  declare
    -- Joey (COACH) also owns the SPL in the demo copy, so the club's side is
    -- probed as HEAD: Hana's parent, made an admin of NRIFA for the probe.
    HEAD constant uuid := '00000000-0000-0000-0000-0000000000b4';
    v_c uuid; v_org uuid; v_league uuid; v_div text; v_team uuid; v_players int; v_other int;
    v_st jsonb; v_mine jsonb; v_club jsonb; v_pay uuid; v_expect bigint;
    b_set boolean; b_parent boolean; b_rec boolean; b_undo boolean;
    r164 text; r165 text; r166 text;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, HEAD, 'wwcc', 'RLS164', 'cleared', current_date + 300, COACH) on conflict do nothing;
      update public.academy_members set role = 'admin' where academy_id = ACAD_A and profile_id = HEAD;
      select cc.competition_id, c.organiser_id, ce.division, ce.team_id
        into v_c, v_org, v_div, v_team
        from public.competition_clubs cc
        join public.competitions c on c.id = cc.competition_id
        join public.competition_entries ce on ce.competition_id = cc.competition_id and ce.academy_id = cc.academy_id and ce.team_id is not null
       where cc.academy_id = ACAD_A and cc.status = 'active'
       order by ce.division
       limit 1;
      if v_c is null then
        raise exception 'no competition with an entered NRIFA squad to probe';
      end if;
      select am.profile_id into v_league from public.academy_members am
       where am.academy_id = v_org and am.status = 'active' and am.role = 'owner' and am.profile_id <> COACH
       order by am.profile_id limit 1;
      if v_league is null then
        select am.profile_id into v_league from public.academy_members am
         where am.academy_id = v_org and am.status = 'active' and am.role in ('owner', 'admin') order by am.profile_id limit 1;
      end if;
      select count(*) into v_players from public.players pl where pl.team_id = v_team;
      -- What NRIFA should owe: its entered squads' players, by division.
      -- 164. Only the organiser sets a levy; the statement adds up.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b_set := false;
      begin perform public.set_competition_levy(v_c, '', 1000); exception when others then b_set := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',v_league,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.set_competition_levy(v_c, '', 1000, 'Bank transfer to the league, reference your club');
      v_st := public.set_competition_levy(v_c, v_div, 1200);
      execute 'reset role';
      select sum(case when ce.division = v_div then 1200 else 1000 end * (select count(*) from public.players pl where pl.team_id = ce.team_id))
        into v_expect
        from public.competition_entries ce
       where ce.competition_id = v_c and ce.academy_id = ACAD_A and ce.team_id is not null;
      select x into v_club from jsonb_array_elements(v_st -> 'clubs') x where (x ->> 'club_id')::uuid = ACAD_A;
      r164 := case when b_set and v_club is not null and (v_club ->> 'owed_cents')::bigint = v_expect
                         and exists (select 1 from jsonb_array_elements(v_club -> 'lines') l where l ->> 'division' = v_div and (l ->> 'levy_cents')::int = 1200 and (l ->> 'players')::int = v_players)
                         and jsonb_array_length(v_st -> 'levies') = 2
                    then 'PASS'
                    else 'FAIL (parent refused '||b_set||', NRIFA owes '||coalesce(v_club ->> 'owed_cents', 'none')||' expected '||v_expect||', '||coalesce(v_st::text, 'null')||')' end;

      -- 165. A club's staff see their own statement and nobody else's; a
      -- family sees nothing of it.
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_mine := public.my_levy_statement(v_c);
      select count(*) into v_other from public.levy_payments where competition_id = v_c and club_academy_id <> ACAD_A;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b_parent := false;
      begin perform public.my_levy_statement(v_c); exception when others then b_parent := (sqlstate = '42501'); end;
      select count(*) into n from public.competition_levies where competition_id = v_c;
      execute 'reset role';
      r165 := case when (v_mine ->> 'club_id')::uuid = ACAD_A and (v_mine ->> 'owed_cents')::bigint = v_expect
                         and v_mine ->> 'instructions' like 'Bank transfer%' and b_parent
                    then 'PASS'
                    else 'FAIL (own club '||coalesce(v_mine ->> 'club', 'none')||' owes '||coalesce(v_mine ->> 'owed_cents', 'none')||', parent refused '||b_parent||')' end;

      -- 166. Recording a payment is the organiser's: the club cannot; $20 by
      -- bank brings the balance down for both views; only the organiser undoes it.
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      b_rec := false;
      begin perform public.record_levy_payment(v_c, ACAD_A, 2000, 'bank'); exception when others then b_rec := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',v_league,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_st := public.record_levy_payment(v_c, ACAD_A, 2000, 'bank', 'ref SPL-NRIFA');
      execute 'reset role';
      select x into v_club from jsonb_array_elements(v_st -> 'clubs') x where (x ->> 'club_id')::uuid = ACAD_A;
      v_pay := (v_club -> 'payments' -> 0 ->> 'id')::uuid;
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_mine := public.my_levy_statement(v_c);
      b_undo := false;
      begin perform public.undo_levy_payment(v_pay); exception when others then b_undo := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',v_league,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_st := public.undo_levy_payment(v_pay);
      execute 'reset role';
      r166 := case when b_rec and (v_club ->> 'paid_cents')::int = 2000 and (v_club ->> 'balance_cents')::bigint = v_expect - 2000
                         and (v_mine ->> 'paid_cents')::int = 2000 and b_undo
                         and (select (x ->> 'paid_cents')::int from jsonb_array_elements(v_st -> 'clubs') x where (x ->> 'club_id')::uuid = ACAD_A) = 0
                    then 'PASS'
                    else 'FAIL (club refused '||b_rec||', paid '||coalesce(v_club ->> 'paid_cents', 'none')||', club sees '||coalesce(v_mine ->> 'paid_cents', 'none')||', undo refused for the club '||b_undo||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r164 := coalesce(r164, 'FAIL (stopped: '||sqlerrm||')');
        r165 := coalesce(r165, 'FAIL (stopped: '||sqlerrm||')');
        r166 := coalesce(r166, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (164, 'only the organiser sets the player levy, and what a club owes is its entered players times the division''s rate', r164);
    insert into rls_results values (165, 'a club''s staff see their own levy statement and nobody else''s; a family sees nothing of it', r165);
    insert into rls_results values (166, 'only the organiser records or undoes a club''s payment, and both sides see the balance move', r166);
  end;

  -- 0231. Two-step is compulsory for those who run things. Rolled back: a
  -- new club (requires it by default) with COACH as owner and MARCUS as a
  -- squad's coach; a new league with MARCUS as competition manager.
  declare
    v_new uuid; v_lg uuid; v_tm uuid; v_st jsonb;
    b_default boolean; b_nrifa boolean; b_parent boolean; b_after boolean;
    s_none boolean; s_factor boolean; s_aal2 boolean; c_coach boolean; l_weak int; l_strong int; g_sam boolean;
    r167 text; r168 text; r169 text;
  begin
    begin
      insert into public.academies (name, slug, type, primary_colour) values ('RLS 167 FC', 'rls-167-fc', 'academy', '#333333') returning id into v_new;
      insert into public.academies (name, slug, type, primary_colour) values ('RLS 169 League', 'rls-169-league', 'league', '#333333') returning id into v_lg;
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (v_new, COACH, 'wwcc', 'RLS167A', 'cleared', current_date + 300, COACH), (v_new, MARCUS, 'wwcc', 'RLS167B', 'cleared', current_date + 300, COACH)
      on conflict do nothing;
      insert into public.academy_members (academy_id, profile_id, role, status) values (v_new, COACH, 'owner', 'active'), (v_new, MARCUS, 'coach', 'active');
      insert into public.teams (academy_id, name, age_group, season, status, created_by) values (v_new, 'RLS 167 U9', 'U9', '2026', 'active', COACH) returning id into v_tm;
      insert into public.team_members (academy_id, team_id, profile_id, role) values (v_new, v_tm, MARCUS, 'coach');
      insert into public.league_roles (academy_id, profile_id, role) values (v_lg, MARCUS, 'competition_manager');

      -- 167. New organisations require it; the ones that exist do not until an
      -- owner turns it on — one way, and it bites at once.
      select two_step_required into b_default from public.academies where id = v_new;
      select two_step_required into b_nrifa from public.academies where id = ACAD_A;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      b_parent := false;
      begin perform public.require_two_step(ACAD_A); exception when others then b_parent := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      perform public.require_two_step(ACAD_A);
      b_after := coalesce(app_private.is_academy_staff(ACAD_A), false);
      v_st := public.two_step_status();
      execute 'reset role';
      r167 := case when b_default and not b_nrifa and b_parent and not b_after
                         and (v_st ->> 'required')::boolean and not (v_st ->> 'enrolled')::boolean
                    then 'PASS'
                    else 'FAIL (new requires '||b_default||', NRIFA before '||b_nrifa||', parent refused '||b_parent||', owner still staff after '||b_after||', status '||coalesce(v_st::text, 'null')||')' end;
      update public.academies set two_step_required = false where id = ACAD_A;

      -- 168. At the new club: its owner has no powers without an authenticator
      -- app, none with one on a password alone, all of them with both steps;
      -- its coach, with nothing enrolled, still coaches.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      s_none := coalesce(app_private.is_academy_staff(v_new), false);
      execute 'reset role';
      insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
      values (gen_random_uuid(), COACH, 'rls-probe-168', 'totp', 'verified', now(), now());
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      s_factor := coalesce(app_private.is_academy_staff(v_new), false);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated','aal','aal2')::text, true);
      execute 'set local role authenticated';
      s_aal2 := coalesce(app_private.is_academy_staff(v_new), false);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      c_coach := coalesce(app_private.is_team_coach(v_tm), false);
      execute 'reset role';
      r168 := case when not s_none and not s_factor and s_aal2 and c_coach then 'PASS'
                   else 'FAIL (no app '||s_none||', password only '||s_factor||', both steps '||s_aal2||', the coach still coaches '||c_coach||')' end;

      -- 169. League staff at a league that requires it, the same way; a
      -- family is untouched.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      select cardinality(app_private.league_roles_of(v_lg)) into l_weak;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated','aal','aal2')::text, true);
      execute 'set local role authenticated';
      select cardinality(app_private.league_roles_of(v_lg)) into l_strong;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      g_sam := coalesce(app_private.is_guardian_of('00000000-0000-0000-0000-0000000e0001'), false)
               and not (public.two_step_status() ->> 'required')::boolean;
      execute 'reset role';
      r169 := case when l_weak = 0 and l_strong = 1 and g_sam then 'PASS'
                   else 'FAIL (league roles '||l_weak||'/'||l_strong||', Sam untouched and not required '||g_sam||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r167 := coalesce(r167, 'FAIL (stopped: '||sqlerrm||')');
        r168 := coalesce(r168, 'FAIL (stopped: '||sqlerrm||')');
        r169 := coalesce(r169, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (167, 'a new organisation requires two-step; an existing one does not until its owner turns it on, one way, and it bites at once', r167);
    insert into rls_results values (168, 'where required, an owner has no powers without an authenticator app or with a password alone, all of them with both steps; a coach still coaches', r168);
    insert into rls_results values (169, 'league staff at a league that requires it need both steps; a family is untouched', r169);
  end;

  -- 0232. The second step is a code by text: a pass for the session, the
  -- server's word only; a trusted device for 30 days; a coach never asked.
  -- Rolled back: a club made today (requires by default), OUTSIDER its
  -- owner, MARCUS its coach.
  declare
    v_new uuid; v_sess uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_new_sess uuid := gen_random_uuid(); v_until timestamptz;
    r_none public.academy_role; r_pass public.academy_role; r_other_sess public.academy_role; r_expired public.academy_role; r_other_person public.academy_role;
    r_coach public.academy_role; r_trusted public.academy_role;
    s_none jsonb; s_pass jsonb; s_coach jsonb; t_known jsonb; t_unknown jsonb; t_expired jsonb;
    m_pass boolean; n_hash integer;
    r170 text; r171 text; r172 text; r173 text;
  begin
    begin
      insert into public.academies (name, slug, type, primary_colour) values ('RLS 170 FC', 'rls-170-fc', 'academy', '#333333') returning id into v_new;
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (v_new, OUTSIDER, 'wwcc', 'RLS170A', 'cleared', current_date + 300, COACH), (v_new, MARCUS, 'wwcc', 'RLS170B', 'cleared', current_date + 300, COACH)
      on conflict do nothing;
      insert into public.academy_members (academy_id, profile_id, role, status) values (v_new, OUTSIDER, 'owner', 'active'), (v_new, MARCUS, 'coach', 'active');

      -- 170. The owner with a password alone has no owner's powers; with the
      -- server's pass for this session they have them all. The pass is the
      -- server's to give: a member cannot call two_step_pass.
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1','session_id',v_sess)::text, true);
      execute 'set local role authenticated';
      r_none := app_private.academy_role_of(v_new);
      s_none := public.two_step_status();
      execute 'reset role';
      m_pass := has_function_privilege('authenticated', 'public.two_step_pass(uuid, uuid, boolean, text, text)', 'execute');
      perform public.two_step_pass(OUTSIDER, v_sess, false, null, null);
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1','session_id',v_sess)::text, true);
      execute 'set local role authenticated';
      r_pass := app_private.academy_role_of(v_new);
      s_pass := public.two_step_status();
      execute 'reset role';
      r170 := case when r_none is null and (s_none->>'required')::boolean and not (s_none->>'ok')::boolean
                    and r_pass = 'owner' and (s_pass->>'ok')::boolean and (s_pass->>'passed')::boolean and not m_pass then 'PASS'
                   else 'FAIL (no code: role '||coalesce(r_none::text,'none')||' status '||coalesce(s_none::text,'null')||'; passed: role '||coalesce(r_pass::text,'none')||' status '||coalesce(s_pass::text,'null')||'; member may mint a pass '||m_pass||')' end;

      -- 171. A pass is one session's: another session of theirs has none,
      -- an expired pass is no pass, and a pass minted for somebody else's
      -- session id is not theirs.
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1','session_id',v_other)::text, true);
      execute 'set local role authenticated';
      r_other_sess := app_private.academy_role_of(v_new);
      execute 'reset role';
      update public.two_step_passes set trusted_until = now() - interval '1 minute' where session_id = v_sess;
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1','session_id',v_sess)::text, true);
      execute 'set local role authenticated';
      r_expired := app_private.academy_role_of(v_new);
      execute 'reset role';
      perform public.two_step_pass(MARCUS, v_other, false, null, null);
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1','session_id',v_other)::text, true);
      execute 'set local role authenticated';
      r_other_person := app_private.academy_role_of(v_new);
      execute 'reset role';
      r171 := case when r_other_sess is null and r_expired is null and r_other_person is null then 'PASS'
                   else 'FAIL (another session '||coalesce(r_other_sess::text,'none')||', expired '||coalesce(r_expired::text,'none')||', someone else''s pass '||coalesce(r_other_person::text,'none')||')' end;

      -- 172. A coach at the same club is never asked, and coaches as before.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated','aal','aal1','session_id',gen_random_uuid())::text, true);
      execute 'set local role authenticated';
      r_coach := app_private.academy_role_of(v_new);
      s_coach := public.two_step_status();
      execute 'reset role';
      r172 := case when r_coach = 'coach' and not (s_coach->>'required')::boolean and (s_coach->>'where') is null then 'PASS'
                   else 'FAIL (coach role '||coalesce(r_coach::text,'none')||', status '||coalesce(s_coach::text,'null')||')' end;

      -- 173. "Trust this device for 30 days": the server trusts the device
      -- at the pass; a new session on it gets its pass with no code, for the
      -- device's remaining 30 days; an unknown device gets nothing; a device
      -- whose trust ran out gets nothing; only the device's hash is kept.
      delete from public.two_step_passes where profile_id = OUTSIDER;
      perform public.two_step_pass(OUTSIDER, v_sess, true, 'device-token-rls-173', 'RLS phone');
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1','session_id',v_new_sess)::text, true);
      execute 'set local role authenticated';
      t_unknown := public.two_step_trust_this_session('some-other-device');
      t_known := public.two_step_trust_this_session('device-token-rls-173');
      r_trusted := app_private.academy_role_of(v_new);
      execute 'reset role';
      select p.trusted_until into v_until from public.two_step_passes p where p.session_id = v_new_sess;
      update public.trusted_devices set trusted_until = now() - interval '1 day' where profile_id = OUTSIDER;
      delete from public.two_step_passes where profile_id = OUTSIDER;
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1','session_id',gen_random_uuid())::text, true);
      execute 'set local role authenticated';
      t_expired := public.two_step_trust_this_session('device-token-rls-173');
      execute 'reset role';
      select count(*) into n_hash from public.trusted_devices where profile_id = OUTSIDER and device_hash = 'device-token-rls-173';
      r173 := case when not (t_unknown->>'trusted')::boolean and (t_known->>'trusted')::boolean and r_trusted = 'owner'
                    and v_until between now() + interval '29 days' and now() + interval '31 days'
                    and not (t_expired->>'trusted')::boolean and n_hash = 0 then 'PASS'
                   else 'FAIL (unknown device '||coalesce(t_unknown::text,'null')||', known '||coalesce(t_known::text,'null')||' → role '||coalesce(r_trusted::text,'none')||', until '||coalesce(v_until::text,'null')||', expired device '||coalesce(t_expired::text,'null')||', token stored in clear '||n_hash||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r170 := coalesce(r170, 'FAIL (stopped: '||sqlerrm||')');
        r171 := coalesce(r171, 'FAIL (stopped: '||sqlerrm||')');
        r172 := coalesce(r172, 'FAIL (stopped: '||sqlerrm||')');
        r173 := coalesce(r173, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (170, 'an owner with a password alone has no powers; with the server''s pass for the session they have them, and only the server mints one', r170);
    insert into rls_results values (171, 'a pass is one session''s: another session, an expired pass, or someone else''s pass gives nothing', r171);
    insert into rls_results values (172, 'a coach at a club that requires two-step is never asked', r172);
    insert into rls_results values (173, 'a trusted device gives a new session its pass for the device''s 30 days; unknown or lapsed devices nothing; only the hash is kept', r173);
  end;

  -- 0235. A competition's Clubs chat, organiser ↔ club-head chats, a league's
  -- Referees chat. Rolled back: the competition NRIFA has entered, its
  -- organiser's owner; HEAD (Hana's parent) made an admin of NRIFA — a club
  -- head who is not also the league; OUTSIDER made owner of a club that has
  -- not entered; MARCUS a referee of the league.
  declare
    HEAD constant uuid := '00000000-0000-0000-0000-0000000000b4';
    v_c uuid; v_org uuid; v_league uuid; v_ch uuid; v_ref uuid; v_other uuid; v_dm uuid; v_msg uuid;
    m_league boolean; m_head boolean; m_parent boolean; m_coach boolean; m_other boolean; n_hand integer;
    p_parent boolean; r_parent int; r_head int; d_bad1 boolean; d_bad2 boolean; d_bad3 boolean; d_members int;
    f_ref boolean; f_parent boolean; f_host boolean;
    r174 text; r175 text; r176 text; r177 text;
  begin
    begin
      select cc.competition_id, c.organiser_id into v_c, v_org
        from public.competition_clubs cc join public.competitions c on c.id = cc.competition_id
       where cc.academy_id = ACAD_A and cc.status = 'active' order by c.created_at limit 1;
      if v_c is null then raise exception 'no competition with NRIFA entered to probe'; end if;
      select am.profile_id into v_league from public.academy_members am
       where am.academy_id = v_org and am.status = 'active' and am.role = 'owner' and am.profile_id <> COACH order by am.profile_id limit 1;
      if v_league is null then
        select am.profile_id into v_league from public.academy_members am
         where am.academy_id = v_org and am.status = 'active' and am.role in ('owner', 'admin') order by am.profile_id limit 1;
      end if;
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, HEAD, 'wwcc', 'RLS170', 'cleared', current_date + 300, COACH) on conflict do nothing;
      update public.academy_members set role = 'admin' where academy_id = ACAD_A and profile_id = HEAD;
      insert into public.academies (name, slug, type, primary_colour, two_step_required) values ('RLS 174 FC', 'rls-174-fc', 'academy', '#333333', false) returning id into v_other;
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (v_other, OUTSIDER, 'wwcc', 'RLS170B', 'cleared', current_date + 300, COACH) on conflict do nothing;
      insert into public.academy_members (academy_id, profile_id, role, status) values (v_other, OUTSIDER, 'owner', 'active');
      insert into public.referees (academy_id, profile_id, full_name, status) values (v_org, MARCUS, 'Marcus Obi', 'active') on conflict do nothing;
      v_ch := app_private.ensure_clubs_channel(v_c);
      v_ref := app_private.ensure_referees_channel(v_org);

      -- 174. Who is in the Clubs chat: the league and the entered clubs' heads;
      -- not a parent, not a coach, not the head of a club that has not entered.
      perform set_config('request.jwt.claims', json_build_object('sub',v_league,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      m_league := app_private.is_channel_member(v_ch) and app_private.is_channel_host(v_ch);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      m_head := app_private.is_channel_member(v_ch) and not app_private.is_channel_host(v_ch);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      m_parent := app_private.is_channel_member(v_ch);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      m_coach := app_private.is_channel_member(v_ch);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      m_other := app_private.is_channel_member(v_ch);
      execute 'reset role';
      r174 := case when v_ch is not null and m_league and m_head and not m_parent and not m_coach and not m_other then 'PASS'
                   else 'FAIL (channel '||coalesce(v_ch::text,'none')||', league '||m_league||', head '||m_head||', parent '||m_parent||', coach '||m_coach||', other club '||m_other||')' end;

      -- 175. Two-way for its members: the head posts and reads; a parent can
      -- neither read nor write; nobody is added to it by hand.
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.messages (academy_id, channel_id, sender_id, body) values (v_org, v_ch, HEAD, 'RLS 175 from a club head') returning id into v_msg;
      select count(*) into r_head from public.channel_messages(v_ch, null, 50);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      p_parent := false;
      begin insert into public.messages (academy_id, channel_id, sender_id, body) values (v_org, v_ch, PARENT, 'RLS 175 nope'); exception when others then p_parent := true; end;
      r_parent := 0;
      begin select count(*) into r_parent from public.channel_messages(v_ch, null, 50); exception when others then r_parent := 0; end;
      execute 'reset role';
      n_hand := 0;
      begin insert into public.channel_members (academy_id, channel_id, profile_id, role) values (v_org, v_ch, PARENT, 'member'); n_hand := 1; exception when others then null; end;
      r175 := case when v_msg is not null and r_head >= 1 and p_parent and r_parent = 0 and n_hand = 0 then 'PASS'
                   else 'FAIL (head posted '||(v_msg is not null)||' and reads '||r_head||', parent refused '||p_parent||' and reads '||r_parent||', added by hand '||n_hand||')' end;

      -- 176. Direct: the league with an entered club's head, and back; never
      -- a parent, never one head with another, never a club that has not entered.
      perform set_config('request.jwt.claims', json_build_object('sub',v_league,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_dm := public.open_competition_direct(v_c, HEAD);
      d_bad1 := false;
      begin perform public.open_competition_direct(v_c, PARENT); exception when others then d_bad1 := (sqlstate = '42501'); end;
      execute 'reset role';
      select count(*) into d_members from public.channel_members where channel_id = v_dm and profile_id in (v_league, HEAD);
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      d_bad2 := false;
      begin perform public.open_competition_direct(v_c, OUTSIDER); exception when others then d_bad2 := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      d_bad3 := false;
      begin perform public.open_competition_direct(v_c, v_league); exception when others then d_bad3 := (sqlstate = '42501'); end;
      execute 'reset role';
      r176 := case when v_dm is not null and d_members = 2 and d_bad1 and d_bad2 and d_bad3 then 'PASS'
                   else 'FAIL (dm '||coalesce(v_dm::text,'none')||' members '||d_members||', to a parent refused '||d_bad1||', to a club not entered refused '||d_bad2||', a parent to the league refused '||d_bad3||')' end;

      -- 177. The league's Referees chat: its referees and its staff, nobody else.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      f_ref := app_private.is_channel_member(v_ref);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      f_parent := app_private.is_channel_member(v_ref);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',v_league,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      f_host := app_private.is_channel_host(v_ref);
      execute 'reset role';
      r177 := case when v_ref is not null and f_ref and not f_parent and f_host then 'PASS'
                   else 'FAIL (channel '||coalesce(v_ref::text,'none')||', referee in '||f_ref||', parent in '||f_parent||', league hosts '||f_host||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r174 := coalesce(r174, 'FAIL (stopped: '||sqlerrm||')');
        r175 := coalesce(r175, 'FAIL (stopped: '||sqlerrm||')');
        r176 := coalesce(r176, 'FAIL (stopped: '||sqlerrm||')');
        r177 := coalesce(r177, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (174, 'a competition''s Clubs chat is the league and the entered clubs'' heads — no parent, coach or club that has not entered', r174);
    insert into rls_results values (175, 'the Clubs chat is two-way for its members, closed to a parent, and nobody is added by hand', r175);
    insert into rls_results values (176, 'the league and a club''s head may chat directly; never a parent, another club''s head, or a club not entered', r176);
    insert into rls_results values (177, 'a league''s Referees chat is its referees and its staff, nobody else', r177);
  end;

  -- 0236. Big Club Mode, step 1: club roles with a scope, streams, adult
  -- age groups, the activity log. Rolled back. At NRIFA: HEAD (Hana's
  -- parent, cleared) becomes Treasurer; PARENT (Sam, cleared) Registrar;
  -- MARCUS (coach) coordinator of U8 and manager of U12; RAVENS_PARENT a
  -- President of Ravens FC (another club). The owner COACH grants.
  declare
    HEAD constant uuid := '00000000-0000-0000-0000-0000000000b4';
    U8 constant uuid := '00000000-0000-0000-0000-0000000d0008';
    U12 constant uuid := '00000000-0000-0000-0000-0000000d0012';
    v_stream uuid; v_role uuid; v_role2 uuid; v_role3 uuid; v_team uuid; v_pay uuid; v_log_before bigint;
    t_money boolean; t_regs boolean; t_med int; t_pay int; r_regs boolean; r_money boolean; r_pay int; r_progs int;
    c_u8 boolean; c_u12 boolean; c_dev boolean; m_u12 boolean; m_u8 boolean; m_dev boolean;
    g_parent boolean; g_wwcc boolean; w_officer boolean;
    l_rows int; l_seen int; l_parent int; adult_ok boolean; adult_bad boolean; stream_dup boolean;
    acc jsonb;
    r178 text; r179 text; r180 text; r181 text; r182 text; r183 text;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, HEAD, 'wwcc', 'RLS178A', 'cleared', current_date + 300, COACH),
             (ACAD_A, PARENT, 'wwcc', 'RLS178B', 'cleared', current_date + 300, COACH)
      on conflict do nothing;
      select count(*) into v_log_before from public.activity_log where academy_id = ACAD_A;

      -- 178. Roles are handed out by the owner (not a parent), need a check
      -- on record (the Treasurer excepted), and are logged.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      g_parent := false;
      begin perform public.grant_club_role(ACAD_A, HEAD, 'treasurer'); exception when others then g_parent := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      g_wwcc := false;
      begin perform public.grant_club_role(ACAD_A, OUTSIDER, 'registrar'); exception when others then g_wwcc := true; end;  -- not a member, and no check
      v_role := public.grant_club_role(ACAD_A, HEAD, 'treasurer');
      v_role2 := public.grant_club_role(ACAD_A, PARENT, 'registrar');
      v_role3 := public.grant_club_role(ACAD_A, MARCUS, 'coordinator', 'age_group', null, 'U8', null);
      perform public.grant_club_role(ACAD_A, MARCUS, 'team_manager', 'team', null, null, U12);
      perform public.grant_club_role(ACAD_A, HEAD, 'welfare_officer');
      execute 'reset role';
      select count(*) into l_rows from public.activity_log where academy_id = ACAD_A and action = 'role.granted';
      r178 := case when g_parent and g_wwcc and v_role is not null and v_role2 is not null and v_role3 is not null and l_rows >= 5 then 'PASS'
                   else 'FAIL (parent refused '||g_parent||', no check refused '||g_wwcc||', granted '||coalesce(v_role::text,'none')||', logged '||l_rows||')' end;

      -- 179. The Treasurer: money, never medical. The register, the fees,
      -- the vouchers, the finance export answer; medical rows do not.
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      t_money := app_private.may_run_club(ACAD_A, 'money');
      t_regs := app_private.may_run_club(ACAD_A, 'registrations');
      t_pay := 0;
      begin perform * from public.outstanding_fees(ACAD_A); t_pay := 1; exception when others then t_pay := 0; end;  -- the who-owes list answers the Treasurer
      select count(*) into t_med from public.player_medical where academy_id = ACAD_A;
      execute 'reset role';
      r179 := case when t_money and not t_regs and t_pay = 1 and t_med = 0 then 'PASS'
                   else 'FAIL (money '||t_money||', registrations '||t_regs||', who-owes answers '||t_pay||', medical read '||t_med||')' end;

      -- 180. The Registrar: registrations and programs, not money.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      r_regs := app_private.may_run_club(ACAD_A, 'registrations');
      r_money := app_private.may_run_club(ACAD_A, 'money');
      select count(*) into r_progs from public.program_registrations where academy_id = ACAD_A;
      r_pay := 0;
      begin perform * from public.outstanding_fees(ACAD_A); exception when others then r_pay := case when sqlstate = '42501' then 1 else 0 end; end;  -- the who-owes list refuses the Registrar
      execute 'reset role';
      r180 := case when r_regs and not r_money and r_progs >= 1 and r_pay = 1 then 'PASS'
                   else 'FAIL (registrations '||r_regs||', money '||r_money||', registrations read '||r_progs||', who-owes refused '||r_pay||')' end;

      -- 181. Scope: a coordinator of U8 runs the U8 squad, not the U12; the
      -- U12's manager runs the U12 (as a coach would) but may not write a
      -- player's development report.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      c_u8 := app_private.runs_team(U8);
      c_u12 := app_private.runs_team(U12, false);
      m_u12 := app_private.runs_team(U12, true);
      m_dev := coalesce((select app_private.may_develop(p.id) from public.players p where p.team_id = U12 limit 1), false);
      c_dev := coalesce((select app_private.may_develop(p.id) from public.players p where p.team_id = U8 limit 1), false);
      execute 'reset role';
      r181 := case when c_u8 and not c_u12 and m_u12 and not m_dev and c_dev then 'PASS'
                   else 'FAIL (coordinator U8 '||c_u8||', U12 without manager '||c_u12||', manager U12 '||m_u12||', manager develops '||m_dev||', coordinator develops '||c_dev||')' end;

      -- 182. The Welfare officer is the safeguarding officer, by the same
      -- name the screens already use; and the log is the committee's.
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      w_officer := app_private.is_safeguarding_officer(ACAD_A);
      select count(*) into l_parent from public.activity_log where academy_id = ACAD_A;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into l_seen from public.activity_log where academy_id = ACAD_A;
      acc := public.my_club_access(ACAD_A);
      execute 'reset role';
      r182 := case when w_officer and l_parent = 0 and l_seen > v_log_before and (acc->'areas') ? 'club' then 'PASS'
                   else 'FAIL (officer '||w_officer||', a Treasurer reads the log '||l_parent||', the owner reads '||l_seen||' rows, access '||coalesce(acc::text,'null')||')' end;

      -- 183. Streams and adult age groups: a stream is one per name per
      -- club; an Over-35s team is a team; a shape nobody uses is refused.
      insert into public.streams (academy_id, name) values (ACAD_A, 'RLS Seniors') returning id into v_stream;
      stream_dup := false;
      begin insert into public.streams (academy_id, name) values (ACAD_A, 'RLS Seniors'); exception when unique_violation then stream_dup := true; end;
      adult_ok := false;
      begin
        insert into public.teams (academy_id, name, age_group, season, stream_id) values (ACAD_A, 'RLS Over-35s', 'Over-35', '2099', v_stream) returning id into v_team;
        adult_ok := v_team is not null;
      exception when others then adult_ok := false; end;
      adult_bad := false;
      begin insert into public.teams (academy_id, name, age_group, season) values (ACAD_A, 'RLS Odd', 'Teens', '2099'); exception when check_violation then adult_bad := true; end;
      r183 := case when stream_dup and adult_ok and adult_bad then 'PASS'
                   else 'FAIL (duplicate stream refused '||stream_dup||', Over-35 team made '||adult_ok||', odd shape refused '||adult_bad||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r178 := coalesce(r178, 'FAIL (stopped: '||sqlerrm||')');
        r179 := coalesce(r179, 'FAIL (stopped: '||sqlerrm||')');
        r180 := coalesce(r180, 'FAIL (stopped: '||sqlerrm||')');
        r181 := coalesce(r181, 'FAIL (stopped: '||sqlerrm||')');
        r182 := coalesce(r182, 'FAIL (stopped: '||sqlerrm||')');
        r183 := coalesce(r183, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (178, 'club roles are handed out by those who run the club, need a check on record, and are logged', r178);
    insert into rls_results values (179, 'the Treasurer reads the money and never a medical record', r179);
    insert into rls_results values (180, 'the Registrar runs registrations and never the money', r180);
    insert into rls_results values (181, 'a coordinator runs only the squads in their scope; a team manager runs their team but writes no development report', r181);
    insert into rls_results values (182, 'the Welfare officer is the safeguarding officer; the activity log is the committee''s to read', r182);
    insert into rls_results values (183, 'streams are one per name per club; adult age groups are teams; an odd age group is refused', r183);
  end;

  -- 0237. One membership, many hats. Rolled back. Sam (PARENT) gains a
  -- coach's hat; a club made today has OUTSIDER as owner + parent; HEAD
  -- becomes U12's team manager.
  declare
    HEAD constant uuid := '00000000-0000-0000-0000-0000000000b4';
    U12 constant uuid := '00000000-0000-0000-0000-0000000d0012'; -- Hana's parent is on U8 as a parent already; U12 is a squad she is not on
    v_new uuid; v_roles public.academy_role[]; v_role public.academy_role; v_personas text[]; v_ch uuid; v_jobs jsonb;
    c_coach boolean; c_guardian boolean; only_hat boolean; swapped public.academy_role[];
    o_staff_aal1 boolean; o_roles_aal1 public.academy_role[]; o_staff_aal2 boolean; o_role_aal2 public.academy_role;
    m_member boolean; m_players int; m_chat boolean; m_gone boolean;
    r184 text; r185 text; r186 text;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, PARENT, 'wwcc', 'RLS184', 'cleared', current_date + 300, COACH),
             (ACAD_A, HEAD, 'wwcc', 'RLS186', 'cleared', current_date + 300, COACH)
      on conflict do nothing;

      -- 184. A parent gains a coach's hat and keeps the parent's; the strongest
      -- hat is what one-role readers see; a one-role write swaps that hat and
      -- keeps the rest; the only hat cannot be removed.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_roles := public.add_member_role(ACAD_A, PARENT, 'coach');
      execute 'reset role';
      select m.role into v_role from public.academy_members m where m.academy_id = ACAD_A and m.profile_id = PARENT;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      c_coach := app_private.is_academy_coach(ACAD_A);
      c_guardian := exists (select 1 from public.players p where p.academy_id = ACAD_A and app_private.is_guardian_of(p.id));
      v_personas := array(select jsonb_array_elements_text(public.home_jobs(ACAD_A)->'hats'));
      execute 'reset role';
      update public.academy_members set role = 'parent' where academy_id = ACAD_A and profile_id = PARENT;
      select m.roles into swapped from public.academy_members m where m.academy_id = ACAD_A and m.profile_id = PARENT;
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      only_hat := false;
      begin perform public.remove_member_role(ACAD_A, PARENT, 'parent'); exception when others then only_hat := (sqlstate = '22023'); end;
      execute 'reset role';
      r184 := case when v_roles @> array['coach','parent']::public.academy_role[] and v_role = 'coach' and c_coach and c_guardian
                    and v_personas @> array['coach','parent']::text[] and swapped = array['parent']::public.academy_role[] and only_hat then 'PASS'
                   else 'FAIL (roles '||coalesce(v_roles::text,'null')||', strongest '||coalesce(v_role::text,'null')||', coaches '||c_coach||', still a guardian '||c_guardian||', hats '||coalesce(v_personas::text,'null')||', after a one-role write '||coalesce(swapped::text,'null')||', only hat kept '||only_hat||')' end;

      -- 185. An owner who is also a parent, at a club that requires two-step,
      -- on a password alone: no owner's powers, still the parent's hat.
      insert into public.academies (name, slug, type, primary_colour) values ('RLS 185 FC', 'rls-185-fc', 'academy', '#333333') returning id into v_new;
      insert into public.academy_members (academy_id, profile_id, role, roles, status) values (v_new, OUTSIDER, 'owner', array['owner','parent']::public.academy_role[], 'active');
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal1')::text, true);
      execute 'set local role authenticated';
      o_staff_aal1 := app_private.is_academy_staff(v_new);
      o_roles_aal1 := app_private.member_roles_of(v_new);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated','aal','aal2')::text, true);
      execute 'set local role authenticated';
      o_staff_aal2 := app_private.is_academy_staff(v_new);
      o_role_aal2 := app_private.academy_role_of(v_new);
      execute 'reset role';
      r185 := case when not o_staff_aal1 and o_roles_aal1 = array['parent']::public.academy_role[] and o_staff_aal2 and o_role_aal2 = 'owner' then 'PASS'
                   else 'FAIL (aal1 staff '||o_staff_aal1||' roles '||coalesce(o_roles_aal1::text,'null')||'; aal2 staff '||o_staff_aal2||' role '||coalesce(o_role_aal2::text,'null')||')' end;

      -- 186. A team's manager is on the team: reads its roster, is in its
      -- chat, has the manager's Home; revoked, the chat row goes.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_ch := public.grant_club_role(ACAD_A, HEAD, 'team_manager', 'team', null, null, U12);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      m_member := app_private.is_team_member(U12);
      select count(*) into m_players from public.players p where p.team_id = U12;
      m_chat := coalesce((select app_private.is_channel_member(ch.id) from public.channels ch where ch.team_id = U12 and ch.type = 'team' limit 1), false);
      v_jobs := public.home_jobs(ACAD_A, 'manager');
      v_personas := array(select jsonb_array_elements_text(v_jobs->'hats'));
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.revoke_club_role(v_ch);
      execute 'reset role';
      m_gone := not exists (select 1 from public.channel_members cm join public.channels ch on ch.id = cm.channel_id
                             where ch.team_id = U12 and ch.type = 'team' and cm.profile_id = HEAD);
      r186 := case when m_member and m_players >= 1 and m_chat and 'manager' = any (v_personas)
                    and v_jobs->>'persona' = 'manager' and jsonb_array_length(v_jobs->'jobs') = 3 and m_gone then 'PASS'
                   else 'FAIL (on the team '||m_member||', roster rows '||m_players||', in the chat '||m_chat||', hats '||coalesce(v_personas::text,'null')||', home '||coalesce(v_jobs->>'persona','null')||' with '||coalesce(jsonb_array_length(v_jobs->'jobs')::text,'0')||' jobs, chat row gone after '||m_gone||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r184 := coalesce(r184, 'FAIL (stopped: '||sqlerrm||')');
        r185 := coalesce(r185, 'FAIL (stopped: '||sqlerrm||')');
        r186 := coalesce(r186, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (184, 'a member wears several hats: a parent gains a coach''s and keeps the parent''s; one-role readers see the strongest; the only hat stays', r184);
    insert into rls_results values (185, 'an owner who is also a parent keeps the parent''s hat on a password alone where the club requires two-step', r185);
    insert into rls_results values (186, 'a team''s manager is on the team — roster, chat, the manager''s Home — and leaves the chat when the role goes', r186);
  end;

  -- 0239. An adult plays for themselves. Rolled back: an Over-35 squad at
  -- NRIFA, OUTSIDER as a 40-year-old player with their own record and
  -- membership; a child's account still refused.
  declare
    v_team uuid; v_player uuid; v_event uuid; v_child uuid;
    a_row boolean; a_member boolean; a_place boolean; c_login boolean; c_member boolean; d_old boolean; d_future boolean;
    f_self boolean; e_mine int; e_replies int; r_ok boolean;
    r187 text; r188 text;
  begin
    begin
      insert into public.teams (academy_id, name, age_group, season) values (ACAD_A, 'RLS Over-35s', 'Over-35', '2099') returning id into v_team;
      -- 187. The guards: an adult's own record, membership and squad place
      -- go through; a child's login is refused; a date of birth over a
      -- hundred years ago, or in the future, is refused.
      a_row := false;
      begin
        insert into public.players (academy_id, team_id, full_name, dob, profile_id)
        values (ACAD_A, v_team, 'RLS Forty Year Old', current_date - interval '40 years', OUTSIDER) returning id into v_player;
        a_row := v_player is not null;
      exception when others then a_row := false; end;
      a_member := false;
      begin
        insert into public.academy_members (academy_id, profile_id, role, status) values (ACAD_A, OUTSIDER, 'player', 'active');
        a_member := true;
      exception when others then a_member := false; end;
      a_place := false;
      begin
        insert into public.team_members (academy_id, team_id, profile_id, role) values (ACAD_A, v_team, OUTSIDER, 'player');
        a_place := true;
      exception when others then a_place := false; end;
      c_login := false;
      begin
        insert into public.players (academy_id, team_id, full_name, dob, profile_id)
        values (ACAD_A, v_team, 'RLS Ten Year Old', current_date - interval '10 years', PARENT);
      exception when others then c_login := (sqlstate = '42501'); end;
      d_old := false;
      begin insert into public.players (academy_id, full_name, dob) values (ACAD_A, 'RLS Too Old', current_date - interval '101 years'); exception when check_violation then d_old := true; end;
      d_future := false;
      begin insert into public.players (academy_id, full_name, dob) values (ACAD_A, 'RLS Unborn', current_date + 1); exception when check_violation then d_future := true; end;
      r187 := case when a_row and a_member and a_place and c_login and d_old and d_future then 'PASS'
                   else 'FAIL (adult row '||a_row||', membership '||a_member||', squad place '||a_place||', child login refused '||c_login||', 101 years refused '||d_old||', future refused '||d_future||')' end;

      -- 188. The adult reads and answers as themselves: My family lists
      -- them as "self"; their squad's game counts them; they RSVP for
      -- themselves.
      insert into public.events (academy_id, team_id, type, title, starts_at) values (ACAD_A, v_team, 'match', 'RLS Over-35s v Rivals', now() + interval '3 days') returning id into v_event;
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      f_self := exists (select 1 from jsonb_array_elements(public.my_family()) c where (c->>'id')::uuid = v_player and c->>'relationship' = 'self');
      select e.my_children into e_mine from public.my_upcoming_events(ACAD_A, 30) e where e.id = v_event;
      r_ok := false;
      begin
        insert into public.event_rsvps (academy_id, event_id, player_id, profile_id, status) values (ACAD_A, v_event, v_player, OUTSIDER, 'yes');
        r_ok := true;
      exception when others then r_ok := false; end;
      select e.my_replies into e_replies from public.my_upcoming_events(ACAD_A, 30) e where e.id = v_event;
      execute 'reset role';
      r188 := case when f_self and e_mine = 1 and r_ok and e_replies = 1 then 'PASS'
                   else 'FAIL (self in My family '||f_self||', counted on their game '||coalesce(e_mine::text,'null')||', RSVP '||r_ok||', replies '||coalesce(e_replies::text,'null')||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r187 := coalesce(r187, 'FAIL (stopped: '||sqlerrm||')');
        r188 := coalesce(r188, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (187, 'an adult''s own player record, membership and squad place go through; a child''s login is refused; a date of birth is in the past and under 100 years', r187);
    insert into rls_results values (188, 'an adult is listed as self in My family, counted on their own game, and answers for themselves', r188);
  end;

  -- 0240. A team's category, gender and label; an over-35s team enters a
  -- league. Rolled back.
  declare
    v_team uuid; v_comp uuid; v_entry uuid; v_ch text;
    cats text[]; g_ok boolean; g_bad boolean; l_bad boolean; e_ok boolean;
    r189 text; r190 text;
  begin
    begin
      cats := array[app_private.age_category('U9'), app_private.age_category('U18'), app_private.age_category('U21'), app_private.age_category('Open'), app_private.age_category('Over-45')];
      g_ok := false;
      begin
        insert into public.teams (academy_id, name, age_group, season, gender, label) values (ACAD_A, 'RLS Women''s Premier', 'Open', '2099', 'women', 'Women''s Premier League') returning id into v_team;
        g_ok := v_team is not null;
      exception when others then g_ok := false; end;
      g_bad := false;
      begin insert into public.teams (academy_id, name, age_group, season, gender) values (ACAD_A, 'RLS Odd Gender', 'Open', '2099', 'female'); exception when others then g_bad := (sqlstate in ('22P02', '42804')); end;
      l_bad := false;
      begin insert into public.teams (academy_id, name, age_group, season, label) values (ACAD_A, 'RLS Long Label', 'Open', '2099', repeat('x', 61)); exception when check_violation then l_bad := true; end;
      select ch.name into v_ch from public.channels ch where ch.academy_id = ACAD_A and ch.type = 'age_group' and ch.age_group = 'Open';
      r189 := case when cats = array['junior','junior','youth','open','over'] and g_ok and g_bad and l_bad and v_ch = 'Open Age Group' then 'PASS'
                   else 'FAIL (categories '||coalesce(cats::text,'null')||', women''s team '||g_ok||', odd gender refused '||g_bad||', long label refused '||l_bad||', chat '||coalesce(v_ch,'none')||')' end;

      -- 190. The club's owner enters the over-35s team in a league.
      select cc.competition_id into v_comp from public.competition_clubs cc where cc.academy_id = ACAD_A and cc.status = 'active' limit 1;
      update public.teams set age_group = 'Over-35', gender = 'men', label = null where id = v_team;
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      e_ok := false;
      begin
        insert into public.competition_entries (competition_id, academy_id, team_id, division, display_name) values (v_comp, ACAD_A, v_team, 'Over-35 Men', 'NRIFA Over-35s') returning id into v_entry;
        e_ok := v_entry is not null;
      exception when others then e_ok := false; r190 := 'FAIL (entry: '||sqlerrm||')';
      end;
      execute 'reset role';
      r190 := coalesce(r190, case when e_ok then 'PASS' else 'FAIL (no entry)' end);

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r189 := coalesce(r189, 'FAIL (stopped: '||sqlerrm||')');
        r190 := coalesce(r190, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (189, 'a team has a category read from its age group, a gender from five words, a label of the club''s own; the Open age group''s chat reads right', r189);
    insert into rls_results values (190, 'an over-35s team enters a league like any other', r190);
  end;

  -- 0241. The Welfare officer (Member Protection). Rolled back: HEAD
  -- (Hana's parent, cleared) appointed Welfare officer; MARCUS (cleared for
  -- the test) made President; Sam files a concern.
  declare
    HEAD constant uuid := '00000000-0000-0000-0000-0000000000b4';
    v_report uuid; v_role uuid; v_dm uuid;
    s_officer int; s_president int; s_owner int; s_reporter int; told_officer int; told_president int; told_reporter int; told_owner int;
    c_list jsonb; dm_ok boolean;
    r191 text; r192 text;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, HEAD, 'wwcc', 'RLS191A', 'cleared', current_date + 300, COACH), (ACAD_A, MARCUS, 'wwcc', 'RLS191B', 'cleared', current_date + 300, COACH)
      on conflict do nothing;
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_role := public.grant_club_role(ACAD_A, HEAD, 'welfare_officer');
      perform public.grant_club_role(ACAD_A, MARCUS, 'president');
      execute 'reset role';

      -- 191. Sam reports a concern: the officer and the President read it
      -- and are told; the owner (an officer is appointed) and Sam's fellow
      -- parents do not; Sam sees his own.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_report := public.file_conduct_report(ACAD_A, 'concern', 'RLS 191: a concern for the test', current_date, 'RLS Subject', null, true);
      select count(*) into s_reporter from public.conduct_reports where id = v_report;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into s_officer from public.conduct_reports where id = v_report;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into s_president from public.conduct_reports where id = v_report;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into s_owner from public.conduct_reports where id = v_report;
      execute 'reset role';
      select count(*) filter (where profile_id = HEAD), count(*) filter (where profile_id = MARCUS), count(*) filter (where profile_id = PARENT), count(*) filter (where profile_id = COACH)
        into told_officer, told_president, told_reporter, told_owner
        from public.notification_queue where kind = 'report_filed' and (payload->>'id')::uuid = v_report;
      r191 := case when s_reporter = 1 and s_officer = 1 and s_president = 1 and s_owner = 0 and told_officer = 1 and told_president = 1 and told_reporter = 0 and told_owner = 0 then 'PASS'
                   else 'FAIL (reads: reporter '||s_reporter||', officer '||s_officer||', president '||s_president||', owner '||s_owner||'; told: officer '||told_officer||', president '||told_president||', reporter '||told_reporter||', owner '||told_owner||')' end;

      -- 192. Every family sees who the officer is, and may message them even
      -- where parents may not message each other.
      update public.academies set dm_policy = 'staff_only' where id = ACAD_A;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      c_list := public.welfare_contacts(ACAD_A);
      dm_ok := false;
      begin v_dm := public.open_direct_channel(ACAD_A, HEAD); dm_ok := v_dm is not null; exception when others then dm_ok := false; end;
      execute 'reset role';
      r192 := case when exists (select 1 from jsonb_array_elements(c_list->'officers') o where (o->>'profile_id')::uuid = HEAD) and dm_ok then 'PASS'
                   else 'FAIL (contacts '||coalesce(c_list::text,'null')||', parent messages the officer '||dm_ok||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r191 := coalesce(r191, 'FAIL (stopped: '||sqlerrm||')');
        r192 := coalesce(r192, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (191, 'a report is read by, and told to, the Welfare officer and the President only; the reporter sees their own', r191);
    insert into rls_results values (192, 'every family sees the Welfare officer in Settings and may message them whatever the club''s direct-message setting', r192);
  end;

  -- 0242. A feature switch. Rolled back.
  declare
    f_default boolean; f_off boolean; f_back boolean; p_refused boolean; f_list text[]; l_rows int; l_before int;
    r193 text;
  begin
    begin
      select count(*) into l_before from public.activity_log where academy_id = ACAD_A and action in ('feature.off', 'feature.on') and subject_name = 'sponsors';
      f_default := app_private.feature_on(ACAD_A, 'sponsors');
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      p_refused := false;
      begin perform public.set_feature(ACAD_A, 'sponsors', false); exception when others then p_refused := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.set_feature(ACAD_A, 'sponsors', false);
      f_off := app_private.feature_on(ACAD_A, 'sponsors');
      f_list := public.features_off(ACAD_A);
      perform public.set_feature(ACAD_A, 'sponsors', true);
      f_back := app_private.feature_on(ACAD_A, 'sponsors');
      execute 'reset role';
      select count(*) - l_before into l_rows from public.activity_log where academy_id = ACAD_A and action in ('feature.off', 'feature.on') and subject_name = 'sponsors';
      r193 := case when f_default and p_refused and not f_off and 'sponsors' = any (f_list) and f_back and l_rows = 2 then 'PASS'
                   else 'FAIL (on by default '||f_default||', parent refused '||p_refused||', off '||(not f_off)||', listed '||coalesce(f_list::text,'null')||', back on '||f_back||', logged '||l_rows||')' end;
      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then r193 := coalesce(r193, 'FAIL (stopped: '||sqlerrm||')'); end if;
    end;
    execute 'reset role';
    insert into rls_results values (193, 'a feature is on until the club''s runners switch it off; a parent cannot; the list and the log say so', r193);
  end;

  -- 0243. Message the club. Rolled back: MARCUS (cleared for the test) is
  -- President; HEAD (cleared) Treasurer; Sam a parent.
  declare
    HEAD constant uuid := '00000000-0000-0000-0000-0000000000b4';
    U8 constant uuid := '00000000-0000-0000-0000-0000000d0008';
    v_msg uuid; v_members int; v_recipients int; v_preview jsonb; v_q int; v_told int; v_status text; v_seen int; v_reping int; v_mine jsonb; v_hidden int;
    p_refused boolean; t_club boolean; t_unpaid jsonb; c_other boolean;
    r194 text; r195 text; r196 text;
  begin
    begin
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (ACAD_A, MARCUS, 'wwcc', 'RLS194A', 'cleared', current_date + 300, COACH), (ACAD_A, HEAD, 'wwcc', 'RLS194B', 'cleared', current_date + 300, COACH)
      on conflict do nothing;
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.grant_club_role(ACAD_A, MARCUS, 'president');
      perform public.grant_club_role(ACAD_A, HEAD, 'treasurer');
      execute 'reset role';

      -- 194. Who may send what: a parent nothing; the Treasurer the unpaid but
      -- not the club; the President anything, and the reach is every active
      -- member but themselves.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      p_refused := false;
      begin perform public.send_club_message(ACAD_A, 'RLS 194 from a parent', '{"kind":"club"}'::jsonb); exception when others then p_refused := (sqlstate = '42501'); end;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      t_club := (public.preview_club_message(ACAD_A, '{"kind":"club"}'::jsonb)->>'allowed')::boolean;
      t_unpaid := public.preview_club_message(ACAD_A, '{"kind":"unpaid"}'::jsonb);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_preview := public.preview_club_message(ACAD_A, '{"kind":"club"}'::jsonb);
      v_msg := public.send_club_message(ACAD_A, 'RLS 194: training is at 6 pm this week', '{"kind":"club"}'::jsonb, true, null, false);
      execute 'reset role';
      select count(*) into v_members from public.academy_members m where m.academy_id = ACAD_A and m.status = 'active' and m.profile_id <> MARCUS;
      select count(*) into v_recipients from public.club_message_recipients r where r.message_id = v_msg;
      r194 := case when p_refused and not t_club and (t_unpaid->>'allowed')::boolean and (v_preview->>'allowed')::boolean
                    and (v_preview->>'count')::int = v_members and v_recipients = v_members and v_msg is not null then 'PASS'
                   else 'FAIL (parent refused '||p_refused||', treasurer club '||t_club||' unpaid '||coalesce(t_unpaid::text,'null')||', president preview '||coalesce(v_preview::text,'null')||', members '||v_members||', recipients '||v_recipients||')' end;

      -- 195. The worker tells them in a batch; a recipient reads and is seen;
      -- the sender sees the count; the re-ping reaches the unseen only.
      v_q := public.fan_out_club_messages();
      select count(*) into v_told from public.notification_queue n where n.payload->>'club_message_id' = v_msg::text;
      select status into v_status from public.club_messages where id = v_msg;
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_mine := public.my_club_messages(ACAD_A);
      perform public.mark_club_message_seen(v_msg);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select (x->>'seen')::int into v_seen from jsonb_array_elements(public.club_messages_sent(ACAD_A)) x where (x->>'id')::uuid = v_msg;
      v_reping := public.reping_club_message(v_msg);
      execute 'reset role';
      r195 := case when v_q = v_members and v_told = v_members and v_status = 'sent'
                    and exists (select 1 from jsonb_array_elements(v_mine) x where (x->>'id')::uuid = v_msg and (x->>'pinned')::boolean)
                    and v_seen = 1 and v_reping = v_members - 1 then 'PASS'
                   else 'FAIL (worker '||v_q||', told '||v_told||', status '||coalesce(v_status,'null')||', in Sam''s list '||exists (select 1 from jsonb_array_elements(v_mine) x where (x->>'id')::uuid = v_msg)||', seen '||coalesce(v_seen::text,'null')||', re-pinged '||v_reping||' of '||(v_members - 1)||')' end;

      -- 196. A message to the staff is not a parent's to read; a coordinator
      -- of U8 may message U8 and not the whole club.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_msg := public.send_club_message(ACAD_A, 'RLS 196: staff only', '{"kind":"staff"}'::jsonb);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_hidden from public.club_messages m where m.id = v_msg;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.revoke_club_role((select id from public.club_roles where academy_id = ACAD_A and profile_id = MARCUS and role = 'president'));
      perform public.grant_club_role(ACAD_A, MARCUS, 'coordinator', 'age_group', null, 'U8', null);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      c_other := not (public.preview_club_message(ACAD_A, '{"kind":"club"}'::jsonb)->>'allowed')::boolean
                 and (public.preview_club_message(ACAD_A, '{"kind":"age_groups","age_groups":["U8"]}'::jsonb)->>'allowed')::boolean
                 and not (public.preview_club_message(ACAD_A, '{"kind":"age_groups","age_groups":["U12"]}'::jsonb)->>'allowed')::boolean;
      execute 'reset role';
      r196 := case when v_hidden = 0 and c_other then 'PASS'
                   else 'FAIL (parent reads a staff message '||v_hidden||', coordinator scope right '||c_other||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r194 := coalesce(r194, 'FAIL (stopped: '||sqlerrm||')');
        r195 := coalesce(r195, 'FAIL (stopped: '||sqlerrm||')');
        r196 := coalesce(r196, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (194, 'Message the club: a parent cannot, the Treasurer only the unpaid, the President anyone — and the reach is every member but the sender', r194);
    insert into rls_results values (195, 'the worker tells recipients in a batch; a reader is seen; the sender sees the count; the re-ping reaches the unseen only', r195);
    insert into rls_results values (196, 'a staff-only message is not a parent''s to read; a coordinator messages their age group and nothing wider', r196);
  end;

  -- 0245. The club's layers of talk. Rolled back: a club made today (club
  -- mode), OUTSIDER its owner, HEAD a parent there (and Treasurer, then a
  -- team manager), PARENT a parent on a team in the Juniors stream.
  declare
    HEAD constant uuid := '00000000-0000-0000-0000-0000000000b4';
    v_club uuid; v_wide record; v_committee uuid; v_managers uuid; v_streams int; v_stream_channels int;
    v_juniors uuid; v_girls uuid; v_team uuid; v_jch uuid; v_gch uuid;
    in_j1 boolean; in_g1 boolean; in_j2 boolean; in_g2 boolean; in_g3 boolean;
    c_head boolean; c_parent boolean; c_owner_host boolean; m_head_before boolean; m_head_after boolean; m_parent boolean;
    r197 text; r198 text; r199 text;
  begin
    begin
      insert into public.academies (name, slug, type, primary_colour, two_step_required) values ('RLS 197 Club', 'rls-197-club', 'club', '#333333', false) returning id into v_club;
      insert into public.academy_members (academy_id, profile_id, role, status) values (v_club, OUTSIDER, 'owner', 'active'), (v_club, HEAD, 'parent', 'active'), (v_club, PARENT, 'parent', 'active');
      insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
      values (v_club, HEAD, 'wwcc', 'RLS197', 'cleared', current_date + 300, OUTSIDER) on conflict do nothing;

      -- 197. Club mode's layers exist from the first minute.
      select c.posting_mode::text as mode, c.name into v_wide from public.channels c where c.academy_id = v_club and c.type = 'academy_wide';
      select id into v_committee from public.channels where academy_id = v_club and type = 'committee';
      select id into v_managers from public.channels where academy_id = v_club and type = 'managers';
      select count(*) into v_streams from public.streams where academy_id = v_club;
      select count(*) into v_stream_channels from public.channels where academy_id = v_club and type = 'stream' and posting_mode = 'hosts_only';
      r197 := case when v_wide.mode = 'hosts_only' and v_wide.name = 'Club Notices' and v_committee is not null and v_managers is not null and v_streams = 8 and v_stream_channels = 8 then 'PASS'
                   else 'FAIL (club-wide '||coalesce(v_wide.mode,'null')||' "'||coalesce(v_wide.name,'')||'", committee '||(v_committee is not null)||', managers '||(v_managers is not null)||', streams '||v_streams||', stream channels '||v_stream_channels||')' end;

      -- 198. Being on a team puts you in its stream's channel; the team
      -- moving streams moves you; leaving the team takes you out.
      select id into v_juniors from public.streams where academy_id = v_club and name = 'Juniors';
      select id into v_girls from public.streams where academy_id = v_club and name = 'Girls';
      insert into public.teams (academy_id, name, age_group, season, stream_id) values (v_club, 'RLS U9 Lions', 'U9', '2099', v_juniors) returning id into v_team;
      insert into public.team_members (academy_id, team_id, profile_id, role) values (v_club, v_team, PARENT, 'parent');
      select id into v_jch from public.channels where academy_id = v_club and type = 'stream' and stream_id = v_juniors;
      select id into v_gch from public.channels where academy_id = v_club and type = 'stream' and stream_id = v_girls;
      in_j1 := exists (select 1 from public.channel_members where channel_id = v_jch and profile_id = PARENT);
      in_g1 := exists (select 1 from public.channel_members where channel_id = v_gch and profile_id = PARENT);
      update public.teams set stream_id = v_girls where id = v_team;
      in_j2 := exists (select 1 from public.channel_members where channel_id = v_jch and profile_id = PARENT);
      in_g2 := exists (select 1 from public.channel_members where channel_id = v_gch and profile_id = PARENT);
      delete from public.team_members where team_id = v_team and profile_id = PARENT;
      in_g3 := exists (select 1 from public.channel_members where channel_id = v_gch and profile_id = PARENT);
      r198 := case when in_j1 and not in_g1 and not in_j2 and in_g2 and not in_g3 then 'PASS'
                   else 'FAIL (in Juniors '||in_j1||' Girls '||in_g1||'; after the move Juniors '||in_j2||' Girls '||in_g2||'; after leaving '||in_g3||')' end;

      -- 199. The Committee room is the committee's; the managers' room the
      -- managers'; a plain parent is in neither; the owner hosts both.
      insert into public.team_members (academy_id, team_id, profile_id, role) values (v_club, v_team, PARENT, 'parent');
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.grant_club_role(v_club, HEAD, 'treasurer');
      c_owner_host := app_private.is_channel_host(v_committee) and app_private.is_channel_host(v_managers);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      c_head := app_private.is_channel_member(v_committee);
      m_head_before := app_private.is_channel_member(v_managers);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',OUTSIDER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.grant_club_role(v_club, HEAD, 'team_manager', 'team', null, null, v_team);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',HEAD,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      m_head_after := app_private.is_channel_member(v_managers);
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      c_parent := app_private.is_channel_member(v_committee);
      m_parent := app_private.is_channel_member(v_managers);
      execute 'reset role';
      r199 := case when c_owner_host and c_head and not m_head_before and m_head_after and not c_parent and not m_parent then 'PASS'
                   else 'FAIL (owner hosts both '||c_owner_host||', treasurer in committee '||c_head||', in managers before '||m_head_before||' after '||m_head_after||', parent in committee '||c_parent||' managers '||m_parent||')' end;

      raise exception 'rls-probe-rollback';
    exception when others then
      if sqlerrm <> 'rls-probe-rollback' then
        r197 := coalesce(r197, 'FAIL (stopped: '||sqlerrm||')');
        r198 := coalesce(r198, 'FAIL (stopped: '||sqlerrm||')');
        r199 := coalesce(r199, 'FAIL (stopped: '||sqlerrm||')');
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (197, 'a club in club mode has Club Notices (hosts only), hosts-only age groups, a hosts-only channel per stream, a Committee room and a Team managers'' room from the first minute', r197);
    insert into rls_results values (198, 'a team''s people are in its stream''s channel; the team moving streams moves them; leaving the team takes them out', r198);
    insert into rls_results values (199, 'the Committee room is the committee''s and the managers'' room the managers''; a parent is in neither; the owner hosts both', r199);
  end;

  -- 0246. The organiser group. Read-only.
  declare
    LEAGUE_OWNER constant uuid := '00000000-0000-0000-0000-0000000000e1';
    SPL constant uuid := '00000000-0000-0000-0000-0000000a0003';
    v_over jsonb; v_club_over jsonb; v_orgs jsonb; v_spl_comps int;
    r200 text;
  begin
    begin
      perform set_config('request.jwt.claims', json_build_object('sub',LEAGUE_OWNER,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_over := public.group_overview(SPL);
      v_orgs := public.my_organisations_with_competitions();
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_club_over := public.group_overview(SPL);
      execute 'reset role';
      select jsonb_array_length(o->'competitions') into v_spl_comps from jsonb_array_elements(v_orgs) o where (o->>'id')::uuid = SPL;
      r200 := case when jsonb_array_length(v_over->'competitions') >= 1
                    and exists (select 1 from jsonb_array_elements(v_over->'competitions') c where c->>'name' = 'SPL Season 3' and (c->>'clubs')::int >= 1)
                    and v_club_over is null and coalesce(v_spl_comps, 0) >= 1 then 'PASS'
                   else 'FAIL (overview '||coalesce(left(v_over::text, 120),'null')||'; a parent gets '||coalesce(v_club_over::text,'null')||'; switcher lists '||coalesce(v_spl_comps::text,'none')||' under the SPL)' end;
    exception when others then
      r200 := 'FAIL (stopped: '||sqlerrm||')';
    end;
    execute 'reset role';
    insert into rls_results values (200, 'the organiser group sees everything it runs in one overview, with the clubs entered; a parent sees nothing of it; the switcher lists its competitions under it', r200);
  end;

  -- 0247. Getting live: an import is a batch with a squad per row and undo;
  -- club health is the staff's; the setup steps grew. Everything the check
  -- writes is rolled back on purpose at the end of the block.
  declare
    U12 constant uuid := '00000000-0000-0000-0000-0000000d0012';
    v_batch uuid; v_res jsonb; v_undo jsonb; v_stamped int; v_left int;
    v_health jsonb; v_parent_health jsonb; v_steps text[];
    r201 text := 'FAIL (never ran)';
  begin
    begin
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_batch := public.start_import_batch(ACAD_A, 'players', 'rls-check.xlsx');
      v_res := public.import_players(ACAD_A, null, jsonb_build_array(
                 jsonb_build_object('full_name', 'Rls Import One', 'dob', '2014-03-03', 'team_id', U12),
                 jsonb_build_object('full_name', 'Rls Import Two', 'dob', '2014-04-04', 'team_id', U12),
                 jsonb_build_object('full_name', 'Rls Import Three', 'dob', '2014-05-05', 'team_id', '00000000-0000-0000-0000-00000000dead')),
               null, v_batch);
      select count(*) into v_stamped from public.players where import_batch_id = v_batch and team_id = U12;
      v_health := public.club_health(ACAD_A);
      select array_agg(t.s->>'id' order by t.ord) into v_steps
        from jsonb_array_elements(public.setup_progress(ACAD_A)->'steps') with ordinality as t(s, ord);
      v_undo := public.undo_import_batch(v_batch);
      select count(*) into v_left from public.players where import_batch_id = v_batch;
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      v_parent_health := public.club_health(ACAD_A);
      execute 'reset role';
      r201 := case when (v_res->>'created')::int = 2 and jsonb_array_length(v_res->'problems') = 1 and v_stamped = 2
                    and (v_undo->>'removed')::int = 2 and v_left = 0
                    and v_health ? 'families' and v_health ? 'teams_without_manager' and v_health ? 'checks'
                    and (v_health->'families'->>'players') is not null and v_parent_health is null
                    and 'families' = any(v_steps) and 'grounds' = any(v_steps) and 'managers' = any(v_steps) then 'PASS'
                   else 'FAIL (created '||coalesce(v_res->>'created','?')||', problems '||coalesce(jsonb_array_length(v_res->'problems')::text,'?')
                        ||', stamped '||v_stamped||', removed '||coalesce(v_undo->>'removed','?')||', left '||v_left
                        ||', health '||coalesce(left(v_health::text,80),'null')||', parent '||coalesce(v_parent_health::text,'null')
                        ||', steps '||coalesce(array_to_string(v_steps, ','),'none')||')' end;
      raise exception 'rolled back on purpose' using errcode = 'P0001';
    exception when others then
      if sqlerrm <> 'rolled back on purpose' then
        r201 := 'FAIL (stopped: '||sqlerrm||')';
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (201, 'a roster import is a batch: a squad per row, a wrong squad reported, undo removes exactly what it added; club health is the staff''s and not a parent''s; the setup steps name families, grounds and a manager per squad', r201);
  end;

  -- 0249. Trials: ratings are the coaches' own, placements a draft the
  -- staff publish; a family sees neither and is told once. Rolled back.
  declare
    U12 constant uuid := '00000000-0000-0000-0000-0000000d0012';
    LEO constant uuid := '00000000-0000-0000-0000-0000000e0001';
    v_prog uuid; v_board jsonb; v_pub jsonb; v_parent_sees int; v_parent_board jsonb;
    v_told timestamptz; v_notes int; v_guardians int; v_welcome_before int; v_welcome_after int;
    v_rate_refused boolean := false;
    r202 text := 'FAIL (never ran)';
  begin
    begin
      insert into public.programs (academy_id, name, kind, status, season, created_by)
      values (ACAD_A, 'RLS trial', 'trial', 'open', '2026', COACH) returning id into v_prog;
      insert into public.program_registrations (academy_id, program_id, player_id, status, submitted_by)
      values (ACAD_A, v_prog, LEO, 'approved', COACH);
      select count(*) into v_guardians from public.player_guardians g
        join public.academy_members am on am.profile_id = g.profile_id and am.academy_id = ACAD_A and am.status = 'active'
       where g.player_id = LEO;
      select count(*) into v_welcome_before from public.messages m join public.channels c on c.id = m.channel_id
       where c.team_id = U12 and c.type = 'team' and m.body like 'Welcome to %';
      -- Marcus, a coach, rates.
      perform set_config('request.jwt.claims', json_build_object('sub',MARCUS,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.rate_trial_player(v_prog, LEO, 4, 'quick feet');
      execute 'reset role';
      -- The owner rates, reads the board, pencils Leo into U12 and publishes.
      perform set_config('request.jwt.claims', json_build_object('sub',COACH,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.rate_trial_player(v_prog, LEO, 3, null);
      v_board := public.trial_board(v_prog);
      perform public.place_trial_player(v_prog, LEO, U12);
      v_pub := public.publish_teams(ACAD_A, v_prog);
      execute 'reset role';
      select count(*) into v_welcome_after from public.messages m join public.channels c on c.id = m.channel_id
       where c.team_id = U12 and c.type = 'team' and m.body like 'Welcome to %';
      select count(*) into v_notes from public.notification_queue n
       where n.kind = 'team_published' and n.academy_id = ACAD_A and (n.payload->>'program_id')::uuid = v_prog;
      select team_told_at into v_told from public.players where id = LEO;
      -- A parent: no ratings, no board, no rating of their own.
      perform set_config('request.jwt.claims', json_build_object('sub',PARENT,'role','authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_parent_sees from public.trial_ratings where program_id = v_prog;
      v_parent_board := public.trial_board(v_prog);
      begin
        perform public.rate_trial_player(v_prog, LEO, 5, null);
      exception when others then
        v_rate_refused := true;
      end;
      execute 'reset role';
      r202 := case when (v_board->'players'->0->>'avg')::numeric = 3.5 and (v_board->'players'->0->>'count')::int = 2
                    and jsonb_array_length(v_board->'players'->0->'ratings') = 2
                    and (v_pub->>'players')::int = 1 and (v_pub->>'teams')::int = 1 and (v_pub->>'families')::int = v_guardians
                    and v_welcome_after - v_welcome_before = 1 and v_notes = v_guardians and v_told is not null
                    and v_parent_sees = 0 and v_parent_board is null and v_rate_refused then 'PASS'
                   else 'FAIL (board '||coalesce(left((v_board->'players'->0)::text, 140),'null')||'; publish '||coalesce(v_pub::text,'null')
                        ||'; guardians '||v_guardians||'; welcome +'||(v_welcome_after - v_welcome_before)||'; notes '||v_notes
                        ||'; told '||coalesce(v_told::text,'null')||'; parent sees '||v_parent_sees||', board '||coalesce(v_parent_board::text,'null')
                        ||', refused '||v_rate_refused||')' end;
      raise exception 'rolled back on purpose' using errcode = 'P0001';
    exception when others then
      if sqlerrm <> 'rolled back on purpose' then
        r202 := 'FAIL (stopped: '||sqlerrm||')';
      end if;
    end;
    execute 'reset role';
    insert into rls_results values (202, 'a trial''s ratings are the coaches'' own and a parent sees none; the pencilled squads are a draft until published; publishing puts the child on the squad, welcomes the squad and tells each family once', r202);
  end;

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

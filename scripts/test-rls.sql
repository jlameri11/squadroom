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

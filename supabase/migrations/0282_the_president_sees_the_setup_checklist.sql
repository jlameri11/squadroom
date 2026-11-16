-- 0282 — the President sees the setup checklist (16 Nov 2026).
--
-- Home asks for the checklist whenever the hat worn is the owner's or the
-- President's (G-01), but setup_progress answered null to anyone who was not
-- an owner or admin — and the screen hook reads a null answer as a signed-out
-- visitor. A parent-coach who was also made President (test-many-hats; Joey's
-- own account wears several hats) bounced between Home and sign-in for ever.
-- The hook now asks the session first; this lets the committee that runs the
-- club (may_run_club 'club': President, Secretary) read the checklist too.
-- Same body as 0247 otherwise.
create or replace function public.setup_progress(p_academy uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_academy   uuid;
  a           public.academies;
  v_brand     boolean;
  v_squads    boolean;
  v_roster    boolean;
  v_programs  boolean;
  v_coaches   boolean;
  v_session   boolean;
  v_streams   boolean;
  v_committee boolean;
  v_grounds   boolean;
  v_teams     integer;
  v_covered   integer;
  v_players   integer;
  v_joined    integer;
  v_core_done boolean;
  v_steps     jsonb;
  v_done      integer;
begin
  v_academy := app_private.my_academy(p_academy);
  -- The owners and admins, and the committee that runs the club (0236:
  -- President, Secretary) — Home shows the checklist to a President's hat,
  -- and a null here read as "signed out" to the screen hook (16 Nov 2026).
  if v_academy is null or not (coalesce(app_private.is_academy_staff(v_academy), false) or coalesce(app_private.may_run_club(v_academy, 'club'), false)) then
    return null;
  end if;
  select * into a from public.academies where id = v_academy;

  v_brand    := a.logo_url is not null or lower(coalesce(a.primary_colour, '')) <> '#202842';
  v_squads   := exists (select 1 from public.teams t where t.academy_id = v_academy and t.status = 'active');
  v_roster   := exists (select 1 from public.players p where p.academy_id = v_academy);
  v_programs := exists (select 1 from public.programs p where p.academy_id = v_academy);
  v_coaches  := exists (select 1 from public.academy_members m where m.academy_id = v_academy and m.role in ('coach', 'admin') and m.status = 'active')
             or exists (select 1 from public.invites i where i.academy_id = v_academy and i.role in ('coach', 'admin'))
             or exists (select 1 from public.join_links j where j.academy_id = v_academy and j.role in ('coach', 'admin'));
  v_session  := exists (select 1 from public.events e where e.academy_id = v_academy);
  v_streams  := exists (select 1 from public.streams s where s.academy_id = v_academy);
  v_committee := exists (select 1 from public.club_roles r where r.academy_id = v_academy and r.role in ('president', 'secretary'));
  v_grounds  := exists (select 1 from public.venues v where v.academy_id = v_academy);

  -- Every squad with someone in front of it: a coach on the team, or a
  -- team manager over it.
  select count(*),
         count(*) filter (where exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.role = 'coach')
                             or exists (select 1 from public.club_roles r where r.team_id = t.id and r.role = 'team_manager'))
    into v_teams, v_covered
    from public.teams t where t.academy_id = v_academy and t.status = 'active';

  -- Families in the app: players with a guardian who is an active member,
  -- or an adult who is their own.
  select count(*),
         count(*) filter (where p.profile_id is not null
                             or exists (select 1 from public.player_guardians g
                                          join public.academy_members am on am.profile_id = g.profile_id and am.academy_id = p.academy_id and am.status = 'active'
                                         where g.player_id = p.id))
    into v_players, v_joined
    from public.players p where p.academy_id = v_academy;

  v_core_done := v_brand and v_squads and v_roster and v_programs and v_coaches;
  if v_core_done and a.setup_completed_at is null then
    update public.academies set setup_completed_at = now() where id = v_academy;
    a.setup_completed_at := now();
  end if;

  v_steps := jsonb_build_array(
    jsonb_build_object('id', 'brand', 'label', 'Crest and colours', 'done', v_brand, 'href', '/start/setup#brand',
      'detail', case when v_brand then coalesce(nullif(a.primary_colour, ''), '') || case when a.logo_url is not null then ' · crest' else ' · no crest yet' end else 'Pick your colour; add the crest' end),
    jsonb_build_object('id', 'squads', 'label', 'Squads', 'done', v_squads, 'href', '/admin/teams',
      'detail', v_teams || ' active'));
  if coalesce(a.club_mode, false) then
    v_steps := v_steps || jsonb_build_object('id', 'streams', 'label', 'Streams and age groups', 'done', v_streams, 'href', '/admin/teams',
      'detail', case when v_streams then (select count(*) from public.streams s where s.academy_id = v_academy) || ' streams' else 'Juniors, Seniors, Women, Over-35s — the parts of the club, each with its age groups' end);
  end if;
  v_steps := v_steps
    || jsonb_build_object('id', 'coaches', 'label', 'Coaches', 'done', v_coaches, 'href', '/admin/invites',
      'detail', case when v_coaches then 'Invited' else 'A link or a code for each coach; they need a WWCC on file to be given a squad' end)
    || jsonb_build_object('id', 'managers', 'label', 'Someone in front of every squad', 'done', v_teams > 0 and v_covered = v_teams, 'href', '/admin/teams',
      'detail', case when v_teams = 0 then 'A coach or a team manager per squad'
                     when v_covered = v_teams then 'Every squad has a coach or a manager'
                     else (v_teams - v_covered) || ' of ' || v_teams || ' squads with nobody yet' end)
    || jsonb_build_object('id', 'roster', 'label', 'Roster', 'done', v_roster, 'href', '/admin/import/players',
      'detail', v_players || ' players — import a spreadsheet, or add them by hand')
    || jsonb_build_object('id', 'programs', 'label', 'Programs', 'done', v_programs, 'href', '/admin/programs',
      'detail', case when v_programs then (select count(*) from public.programs p where p.academy_id = v_academy) || ' set up' else 'The squad season, a camp, trials — what families register for' end);
  if coalesce(a.club_mode, false) then
    v_steps := v_steps || jsonb_build_object('id', 'committee', 'label', 'Committee roles', 'done', v_committee, 'href', '/admin/roles',
      'detail', case when v_committee then 'President or Secretary named' else 'President, Secretary, Registrar, Treasurer, Welfare officer' end);
  end if;
  v_steps := v_steps
    || jsonb_build_object('id', 'grounds', 'label', 'Grounds', 'done', v_grounds, 'href', '/admin/venues',
      'detail', case when v_grounds then (select count(*) from public.venues v where v.academy_id = v_academy) || ' grounds' else 'Where you play and train, and the pitches on each' end)
    || jsonb_build_object('id', 'families', 'label', 'Invite families', 'done', v_joined > 0, 'href', '/admin/teams',
      'detail', case when v_players = 0 then 'Each squad has a code and a QR for its families'
                     else v_joined || ' of ' || v_players || ' players have a family in the app' end)
    || jsonb_build_object('id', 'session', 'label', 'First training', 'done', v_session, 'href', '/calendar',
      'detail', case when v_session then 'In the calendar' else 'Weekly training, set once' end);
  select count(*) into v_done from jsonb_array_elements(v_steps) s where (s->>'done')::boolean;

  return jsonb_build_object(
    'academy_id', v_academy,
    'name', a.name,
    'slug', a.slug,
    'primary_colour', a.primary_colour,
    'logo_url', a.logo_url,
    'started_at', a.setup_started_at,
    'completed_at', a.setup_completed_at,
    'minutes', round(extract(epoch from (coalesce(a.setup_completed_at, now()) - a.setup_started_at)) / 60),
    'grandfathered', a.setup_completed_at is not null and a.setup_completed_at <= a.setup_started_at + interval '1 minute',
    'steps', v_steps,
    'done', v_done,
    'total', jsonb_array_length(v_steps),
    'complete', v_core_done);
end;
$$;

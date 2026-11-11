-- 0263: the photo — passport-style, private, the club's to see until approved
--
-- The registration brief (Joey, 10 Nov 2026), gap 2, folded in from Part C
-- item 1: a photo step on the public form (face visible, no hat or
-- sunglasses, recent), cropped and resized in the browser, kept in the
-- private player-photos bucket (0146), readable by the club's staff only
-- until approved — then on the player card and the match sheet's ID for
-- the referee. A club can make it required.
--
-- A pending photo lives at <academy>/pending/<request>.jpg, written by the
-- route as the service role (the family has no account yet) and read by the
-- club's coaches and its Registrar; approval moves it to the player's own
-- folder, where 0146's rules apply; a decline removes it. The referee of a
-- game within a day of now may see the card of a player on its sheet — the
-- match-sheet ID.

alter table public.registration_requests add column if not exists photo_path text;
alter table public.academies add column if not exists photo_required boolean not null default false;

-- A pending photo: the club's coaches and whoever runs its registrations.
create or replace function app_private.may_see_photo(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player uuid := app_private.photo_path_player(p_name);
  v_academy uuid;
  v_folder text[] := storage.foldername(p_name);
begin
  if coalesce(v_folder[2], '') = 'pending' then
    begin
      v_academy := v_folder[1]::uuid;
    exception when others then
      return false;
    end;
    return coalesce(app_private.is_academy_coach(v_academy), false) or app_private.may_run_club(v_academy, 'registrations');
  end if;
  if v_player is null then return false; end if;
  select academy_id into v_academy from public.players where id = v_player;
  if v_academy is null or v_folder[1] <> v_academy::text then
    return false;
  end if;
  return app_private.may_see_card(v_player);
end;
$fn$;

-- The card: the family, the club's coaches, the league for the season, the
-- opposition on match day — and now the referee on match day.
create or replace function app_private.may_see_card(p_player uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.players where id = p_player;
  if v_academy is null then return false; end if;
  if coalesce(app_private.is_guardian_of(p_player), false)
     or coalesce(app_private.is_academy_coach(v_academy), false) then
    return true;
  end if;
  if exists (
    select 1 from public.entry_squads q
     where q.player_id = p_player
       and app_private.is_competition_organiser(q.competition_id)
  ) then
    return true;
  end if;
  return exists (
    select 1
      from public.match_sheet_players sp
      join public.match_sheets s on s.id = sp.sheet_id
      join public.fixtures f on f.id = s.fixture_id
     where sp.player_id = p_player
       and coalesce(f.starts_at, now()) between now() - interval '1 day' and now() + interval '1 day'
       and (app_private.can_manage_entry(case when f.home_entry_id = s.entry_id then f.away_entry_id else f.home_entry_id end)
            or coalesce(app_private.is_fixture_referee(f.id), false))
  );
end;
$fn$;

-- The public page says whether a photo is required; the queue carries the photo's path.
create or replace function public.public_programs(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy public.academies;
begin
  select * into v_academy from public.academies where slug = lower(btrim(p_slug));
  if v_academy.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', jsonb_build_object(
      'name', v_academy.name,
      'slug', v_academy.slug,
      'primary_colour', v_academy.primary_colour,
      'logo_url', v_academy.logo_url,
      'timezone', v_academy.timezone,
      'photo_required', v_academy.photo_required
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'kind', p.kind,
               'description', p.description,
               'season', p.season,
               'born_from_year', p.born_from_year,
               'born_to_year', p.born_to_year,
               'gender', p.gender,
               'starts_on', p.starts_on,
               'ends_on', p.ends_on,
               'closes_at', p.closes_at,
               'questions', p.questions,
               'payment_required', p.payment_required,
               'pay_timing', p.pay_timing,
               'amount_cents', (
                 select pr.amount_cents from public.payment_requests pr
                  where pr.id = p.payment_request_id
               ),
               'spots_left', app_private.program_spots_left(p.id),
               'waitlist_enabled', p.waitlist_enabled,
               'requires_official_rego', p.requires_official_rego
             ) order by p.starts_on nulls last, p.name)
        from public.programs p
       where p.academy_id = v_academy.id
         and p.status = 'open'
         and (p.opens_at is null or p.opens_at <= now())
         and (p.closes_at is null or p.closes_at > now())
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'title', c.title,
               'version', c.version,
               'body', c.body,
               'required', c.required
             ) order by c.required desc, c.title)
        from public.consent_documents c
       where c.academy_id = v_academy.id
         and c.published_at is not null
         and c.retired_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;

-- The queue carries the pending photo's path (0162's shape, one column
-- more). A table-returning function cannot grow in place: drop and re-make,
-- then the grants, which the drop takes with it.
drop function if exists public.registration_queue(uuid, text);
create function public.registration_queue(
  p_academy uuid default null,
  p_status  text default 'pending'
)
returns table (
  request_id    uuid,
  program_id    uuid,
  program_name  text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  child_name    text,
  child_dob     date,
  child_gender  text,
  answers       jsonb,
  consents      jsonb,
  status        text,
  created_at    timestamptz,
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  existing_player_id uuid,
  spots_left    integer,
  -- R-18
  ffa_number    text,
  fifa_id       text,
  requires_official boolean,
  official_confirmed_at timestamptz,
  existing_official_status text,
  -- 0263: where the pending photo sits in player-photos, or null.
  photo_path    text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_coach(v_academy), false) then
    return;
  end if;

  return query
  select
    q.id, q.program_id, p.name,
    q.guardian_name, q.guardian_phone, q.guardian_email,
    q.child_name, q.child_dob, q.child_gender,
    q.answers, q.consents, q.status, q.created_at,
    d.full_name, q.decided_at, q.decision_note,
    m.id,
    app_private.program_spots_left(q.program_id),
    q.ffa_number, q.fifa_id, p.requires_official_rego, q.official_confirmed_at,
    m.official_status::text,
    q.photo_path
  from public.registration_requests q
  join public.programs p on p.id = q.program_id
  left join public.profiles d on d.id = q.decided_by
  left join lateral (
    select pl.id, pl.official_status from public.players pl
     where pl.academy_id = v_academy
       and pl.dob = q.child_dob
       and lower(btrim(pl.full_name)) = lower(btrim(q.child_name))
     limit 1
  ) m on true
  where q.academy_id = v_academy
    and (p_status is null or q.status = p_status)
    and q.expires_at > now()
  order by q.created_at;
end;
$fn$;

revoke execute on function public.registration_queue(uuid, text) from public, anon;
grant execute on function public.registration_queue(uuid, text) to authenticated;

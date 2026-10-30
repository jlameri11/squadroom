-- 0162: PlayFootball first.
--
-- R-18. Football Australia's Circular 26-02 (1 Oct 2026) makes NORS —
-- PlayFootball — the "mandatory first point of entry" for any player at an
-- affiliated club, program or competition, and a registration takes effect
-- only once approved there, with a FIFA ID. Clubs must disclose every fee
-- in PlayFootball. Squadroom never does official registration (CLAUDE.md);
-- what it must do is refuse to pretend a child is in a program the rules
-- say they are not yet in.
--
-- PER PROGRAM, not per club: the circular is silent on independent
-- academies and unsanctioned competitions, so a holiday camp and a Premier
-- League squad at the same club can differ. The switch is
-- programs.requires_official_rego.
--
-- APPROVAL IS BLOCKED, twice. The approve route refuses a request for a
-- program that requires it until a human at the club has confirmed the
-- PlayFootball registration on the request (or the child already on the
-- roster is 'registered' / 'not_required'). And a trigger on
-- program_registrations refuses 'approved' for such a program when the
-- player's official status is not confirmed — so an offer accepted after
-- trials, a direct update, or a future route all obey the same rule.
--
-- THE EXPORT, NOT A LOGIN. A club admin downloads the registrations file
-- from their own PlayFootball account and hands it to the importer, which
-- ticks statuses off by FFA number, FIFA ID or name + date of birth.
-- Squadroom never logs in to PlayFootball and never scrapes it.
--
-- FEES DISCLOSED: a per-season tick on the club, with a reminder in
-- settings until it is done. We cannot check it; we can make sure nobody
-- forgot.

alter table public.programs
  add column if not exists requires_official_rego boolean not null default false;

alter table public.players
  add column if not exists fifa_id text;
alter table public.players drop constraint if exists players_fifa_id_shape;
alter table public.players
  add constraint players_fifa_id_shape check (fifa_id is null or fifa_id ~ '^[0-9]{5,20}$');

alter table public.registration_requests
  add column if not exists ffa_number text,
  add column if not exists fifa_id text,
  add column if not exists official_confirmed_at timestamptz,
  add column if not exists official_confirmed_by uuid references public.profiles(id) on delete set null;

alter table public.academies
  add column if not exists playfootball_fees_disclosed_season text,
  add column if not exists playfootball_fees_disclosed_at timestamptz;

-- ---------------------------------------------------------------------
-- The gate on program_registrations
-- ---------------------------------------------------------------------
create or replace function public.guard_official_rego()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_requires boolean;
  v_status public.official_rego_status;
  v_name text;
begin
  if new.status <> 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;
  select requires_official_rego into v_requires from public.programs where id = new.program_id;
  if not coalesce(v_requires, false) then
    return new;
  end if;
  select official_status, full_name into v_status, v_name from public.players where id = new.player_id;
  if v_status not in ('registered', 'not_required') then
    raise exception '% needs their PlayFootball registration confirmed before this program can accept them',
      coalesce(v_name, 'This player') using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists program_registrations_official_gate on public.program_registrations;
create trigger program_registrations_official_gate
  before insert or update of status on public.program_registrations
  for each row execute function public.guard_official_rego();

-- ---------------------------------------------------------------------
-- A human at the club confirms a request's PlayFootball registration
-- ---------------------------------------------------------------------
create or replace function public.confirm_official_rego(p_request uuid, p_confirmed boolean default true)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.registration_requests;
  v_player uuid;
begin
  select * into v_req from public.registration_requests where id = p_request;
  if v_req.id is null or not coalesce(app_private.is_academy_coach(v_req.academy_id), false) then
    raise exception 'that registration is not yours to confirm' using errcode = '42501';
  end if;
  update public.registration_requests
     set official_confirmed_at = case when p_confirmed then now() end,
         official_confirmed_by = case when p_confirmed then auth.uid() end
   where id = p_request;

  -- A child already on the roster is confirmed there too, with the ids
  -- the family gave, so the gate and the roster say the same thing.
  if p_confirmed then
    select pl.id into v_player from public.players pl
     where pl.academy_id = v_req.academy_id
       and pl.dob = v_req.child_dob
       and lower(btrim(pl.full_name)) = lower(btrim(v_req.child_name))
     limit 1;
    if v_player is not null then
      update public.players
         set official_status = 'registered',
             ff_number = coalesce(ff_number, v_req.ffa_number),
             fifa_id = coalesce(fifa_id, v_req.fifa_id),
             updated_at = now()
       where id = v_player;
    end if;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------
-- The club's own PlayFootball export, ticked off
-- ---------------------------------------------------------------------
-- Rows: {full_name | first_name + last_name, dob, ffa_number, fifa_id, status}.
-- Matched by FFA number, then FIFA ID, then name + date of birth. Returns
-- what happened to each row so the club can see who was not found.
create or replace function public.import_official_status(p_academy uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  r jsonb;
  v_name text; v_dob date; v_ffa text; v_fifa text; v_status_text text;
  v_status public.official_rego_status;
  v_player uuid;
  v_matched integer := 0;
  v_confirmed integer := 0;
  v_unmatched jsonb := '[]'::jsonb;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only the club''s staff import PlayFootball exports' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(coalesce(r->>'full_name',
                        btrim(coalesce(r->>'first_name', '') || ' ' || coalesce(r->>'last_name', '')))), '');
    v_dob := case when coalesce(r->>'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'dob')::date end;
    v_ffa := nullif(regexp_replace(coalesce(r->>'ffa_number', ''), '\D', '', 'g'), '');
    v_fifa := nullif(regexp_replace(coalesce(r->>'fifa_id', ''), '\D', '', 'g'), '');
    v_status_text := lower(coalesce(r->>'status', ''));
    -- PlayFootball's own words for "done" and "not yet", loosely, and a
    -- blank status on an export row means the row is a registration.
    v_status := case
      when v_status_text ~ '(pending|await|incomplete|submitted|unpaid|in progress|review)' then 'pending'
      when v_status_text ~ '(cancel|withdraw|reject|declin|inactive|expired)' then 'unknown'
      else 'registered'
    end;

    v_player := null;
    if v_ffa is not null then
      select id into v_player from public.players where academy_id = p_academy and ff_number = v_ffa limit 1;
    end if;
    if v_player is null and v_fifa is not null then
      select id into v_player from public.players where academy_id = p_academy and fifa_id = v_fifa limit 1;
    end if;
    if v_player is null and v_name is not null and v_dob is not null then
      select id into v_player from public.players
       where academy_id = p_academy and dob = v_dob and lower(btrim(full_name)) = lower(v_name)
       limit 1;
    end if;

    if v_player is null then
      v_unmatched := v_unmatched || jsonb_build_object('name', coalesce(v_name, v_ffa, v_fifa, '?'), 'dob', v_dob);
      continue;
    end if;

    v_matched := v_matched + 1;
    update public.players
       set official_status = v_status,
           ff_number = coalesce(v_ffa, ff_number),
           fifa_id = coalesce(v_fifa, fifa_id),
           updated_at = now()
     where id = v_player;

    -- A pending request for the same child is confirmed by the export
    -- too, so the queue does not ask the club to tick what the file said.
    if v_status = 'registered' then
      update public.registration_requests q
         set official_confirmed_at = now(),
             official_confirmed_by = auth.uid(),
             ffa_number = coalesce(q.ffa_number, v_ffa),
             fifa_id = coalesce(q.fifa_id, v_fifa)
       where q.academy_id = p_academy
         and q.status = 'pending'
         and q.official_confirmed_at is null
         and ((v_dob is not null and q.child_dob = v_dob and lower(btrim(q.child_name)) = lower(coalesce(v_name, '')))
              or (v_ffa is not null and q.ffa_number = v_ffa)
              or (v_fifa is not null and q.fifa_id = v_fifa));
      get diagnostics v_confirmed = row_count;
    end if;
  end loop;

  return jsonb_build_object('matched', v_matched, 'confirmed_requests', v_confirmed, 'unmatched', v_unmatched);
end;
$fn$;

-- ---------------------------------------------------------------------
-- The queue says whether PlayFootball is confirmed
-- ---------------------------------------------------------------------
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
  existing_official_status text
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
    m.official_status::text
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

-- The public form knows which programs need PlayFootball first.
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
      'timezone', v_academy.timezone
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

revoke execute on function public.public_programs(text) from public;
grant execute on function public.public_programs(text) to anon, authenticated;
revoke execute on function public.registration_queue(uuid, text) from public, anon;
grant execute on function public.registration_queue(uuid, text) to authenticated;
grant execute on function public.confirm_official_rego(uuid, boolean) to authenticated;
grant execute on function public.import_official_status(uuid, jsonb) to authenticated;

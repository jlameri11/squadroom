-- 0198: the ground, drawn.
--
-- L-29 (Joey, 3 Nov 2026; asked for as "L-27", which is Nominations). A
-- venue has had a name, an address and a note since 0023, and a fixture a
-- free-text field label. A real ground is a shape: two full pitches, one of
-- them cut into thirds on Saturday morning for the U8s, a canteen by the car
-- park, gates that open at eight. So:
--
--   venues     + a map pin and amenities (parking, toilets, canteen).
--   pitches    a full pitch, or a half / third / quarter of one, drawn on a
--              100×100 canvas and named ("Field 1", "1A"). One level deep:
--              a full pitch and its sub-pitches.
--   hours      availability windows per pitch per weekday, many a day. A
--              sub-pitch with none inherits its parent's.
--   sizes      which size an age group plays on — a club's rules, seeded
--              with the MiniRoos-style defaults, and a per-division override.
--   the clash  a trigger on fixtures: a pitch is never booked while itself,
--              its parent or any of its sub-pitches has a game on; siblings
--              do not clash. A game outside a pitch's hours is refused.
--
-- fixtures.field_label and venue_label STAY, and the trigger keeps them
-- true from the pitch — so the run sheet, the public match centre, the
-- referee's list, call-offs and the draw checks all carry on unchanged.
-- Families get the pitch on the game's page, drawn, with directions.

alter table public.venues
  add column if not exists lat        numeric(9, 6),
  add column if not exists lng        numeric(9, 6),
  add column if not exists amenities  jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.pitches (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  venue_id    uuid not null,
  parent_id   uuid references public.pitches(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  size        text not null default 'full' check (size in ('full', 'half', 'third', 'quarter')),
  x           numeric(6, 2) not null default 0,
  y           numeric(6, 2) not null default 0,
  w           numeric(6, 2) not null default 28,
  h           numeric(6, 2) not null default 42,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint pitches_id_academy_key unique (id, academy_id),
  constraint pitches_on_the_canvas check (x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= 100.01 and y + h <= 100.01),
  constraint pitches_sub_is_not_full check (parent_id is null or size <> 'full'),
  foreign key (venue_id, academy_id) references public.venues(id, academy_id) on delete cascade
);
create index if not exists pitches_venue_idx on public.pitches (venue_id, sort, name);

create table if not exists public.pitch_availability (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  pitch_id    uuid not null,
  weekday     integer not null check (weekday between 0 and 6),   -- 0 = Sunday
  opens       time not null,
  closes      time not null,
  constraint pitch_hours_make_sense check (closes > opens),
  foreign key (pitch_id, academy_id) references public.pitches(id, academy_id) on delete cascade
);
create index if not exists pitch_availability_pitch_idx on public.pitch_availability (pitch_id, weekday);

create table if not exists public.pitch_size_rules (
  academy_id  uuid not null references public.academies(id) on delete cascade,
  age_group   text not null check (age_group ~ '^U\d{1,2}$'),
  size        text not null check (size in ('full', 'half', 'third', 'quarter')),
  primary key (academy_id, age_group)
);

alter table public.competition_divisions
  add column if not exists pitch_size text check (pitch_size is null or pitch_size in ('full', 'half', 'third', 'quarter'));

alter table public.fixtures
  add column if not exists pitch_id uuid references public.pitches(id) on delete set null;
create index if not exists fixtures_pitch_time_idx on public.fixtures (pitch_id, starts_at) where pitch_id is not null;

-- ------------------------------------------------------------------- RLS
alter table public.pitches enable row level security;
alter table public.pitch_availability enable row level security;
alter table public.pitch_size_rules enable row level security;

drop policy if exists pitches_select on public.pitches;
create policy pitches_select on public.pitches for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
drop policy if exists pitches_write on public.pitches;
create policy pitches_write on public.pitches for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

drop policy if exists pitch_availability_select on public.pitch_availability;
create policy pitch_availability_select on public.pitch_availability for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
drop policy if exists pitch_availability_write on public.pitch_availability;
create policy pitch_availability_write on public.pitch_availability for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

drop policy if exists pitch_size_rules_select on public.pitch_size_rules;
create policy pitch_size_rules_select on public.pitch_size_rules for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
drop policy if exists pitch_size_rules_write on public.pitch_size_rules;
create policy pitch_size_rules_write on public.pitch_size_rules for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

grant select, insert, update, delete on public.pitches, public.pitch_availability, public.pitch_size_rules to authenticated;

-- --------------------------------------------------------------- helpers
-- A booking on a pitch also occupies its parent and its sub-pitches.
create or replace function app_private.pitch_family(p_pitch uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_pitch
  union
  select p.parent_id from public.pitches p where p.id = p_pitch and p.parent_id is not null
  union
  select c.id from public.pitches c where c.parent_id = p_pitch;
$$;

create or replace function app_private.pitch_tz(p_pitch uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(a.timezone, 'Australia/Sydney')
    from public.pitches p join public.academies a on a.id = p.academy_id
   where p.id = p_pitch;
$$;

-- The game already on this pitch (or its parent, or a sub-pitch) in that
-- window, described — or null when the pitch is free.
create or replace function app_private.pitch_clash(p_pitch uuid, p_from timestamptz, p_to timestamptz, p_except uuid default null)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(p.name, f.field_label, 'the pitch') || ' is booked '
         || to_char(f.starts_at at time zone app_private.pitch_tz(p_pitch), 'HH24:MI') || '–'
         || to_char((f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60))) at time zone app_private.pitch_tz(p_pitch), 'HH24:MI')
         || coalesce(' (' || he.display_name || ' v ' || ae.display_name || ')', '')
    from public.fixtures f
    left join public.pitches p on p.id = f.pitch_id
    left join public.competition_entries he on he.id = f.home_entry_id
    left join public.competition_entries ae on ae.id = f.away_entry_id
   where f.pitch_id in (select app_private.pitch_family(p_pitch))
     and f.id is distinct from p_except
     and f.status not in ('cancelled', 'postponed', 'bye')
     and f.starts_at is not null
     and f.starts_at < p_to
     and f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)) > p_from
   order by f.starts_at
   limit 1;
$$;

-- Open then? The pitch's own windows; a sub-pitch with none uses its
-- parent's; a pitch with none at all is always open.
create or replace function app_private.pitch_open(p_pitch uuid, p_from timestamptz, p_to timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  with w as (
    select pa.weekday, pa.opens, pa.closes from public.pitch_availability pa where pa.pitch_id = p_pitch
    union all
    select pa.weekday, pa.opens, pa.closes
      from public.pitch_availability pa
      join public.pitches c on c.parent_id = pa.pitch_id
     where c.id = p_pitch
       and not exists (select 1 from public.pitch_availability x where x.pitch_id = p_pitch)
  ),
  tz as (select app_private.pitch_tz(p_pitch) as z)
  select not exists (select 1 from w)
      or exists (
        select 1 from w, tz
         where w.weekday = extract(dow from (p_from at time zone tz.z))::integer
           and (p_from at time zone tz.z)::time >= w.opens
           and (p_to at time zone tz.z)::time <= w.closes
           and (p_from at time zone tz.z)::date = (p_to at time zone tz.z)::date);
$$;

-- MiniRoos-style defaults: U6–U7 quarter, U8–U9 third, U10–U11 half, U12+ full.
create or replace function app_private.default_pitch_size(p_age integer)
returns text language sql immutable as $$
  select case when p_age is null then 'full'
              when p_age <= 7 then 'quarter'
              when p_age <= 9 then 'third'
              when p_age <= 11 then 'half'
              else 'full' end;
$$;

-- The size a division plays on: its override, else the organiser's rule
-- for its age group, else the rule for the age token in its name, else the
-- default for that age.
create or replace function app_private.division_pitch_size(p_competition uuid, p_division text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d.pitch_size from public.competition_divisions d where d.competition_id = p_competition and d.division = p_division),
    (select r.size from public.pitch_size_rules r
       join public.competitions c on c.organiser_id = r.academy_id
       join public.competition_divisions d on d.competition_id = c.id and d.division = p_division
      where c.id = p_competition and r.age_group = d.age_group),
    (select r.size from public.pitch_size_rules r
       join public.competitions c on c.organiser_id = r.academy_id
      where c.id = p_competition and r.age_group = substring(p_division from '\mU\d{1,2}\M')),
    app_private.default_pitch_size(coalesce(
      (select app_private.age_number(d.age_group) from public.competition_divisions d where d.competition_id = p_competition and d.division = p_division),
      app_private.age_number(substring(p_division from '\mU\d{1,2}\M')))));
$$;

-- --------------------------------------------------------- the clash rule
create or replace function public.guard_pitch_booking()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_to    timestamptz;
  v_clash text;
begin
  if new.pitch_id is null then
    return new;
  end if;
  -- The labels every existing screen reads, kept true from the pitch.
  new.field_label := (select p.name from public.pitches p where p.id = new.pitch_id);
  new.venue_id    := (select p.venue_id from public.pitches p where p.id = new.pitch_id);
  new.venue_label := coalesce(new.venue_label, (select v.name from public.venues v where v.id = new.venue_id));
  if new.starts_at is null or new.status in ('cancelled', 'postponed', 'bye') then
    return new;
  end if;
  v_to := new.starts_at + make_interval(mins => coalesce(new.duration_mins, 60));
  v_clash := app_private.pitch_clash(new.pitch_id, new.starts_at, v_to, new.id);
  if v_clash is not null then
    raise exception '%', v_clash using errcode = '23P01';
  end if;
  if not app_private.pitch_open(new.pitch_id, new.starts_at, v_to) then
    raise exception '% is not open then — its hours are set in the venue layout', new.field_label using errcode = '23P01';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.guard_pitch_booking() from public, anon, authenticated;
drop trigger if exists fixtures_guard_pitch on public.fixtures;
create trigger fixtures_guard_pitch
  before insert or update of pitch_id, starts_at, duration_mins, status on public.fixtures
  for each row execute function public.guard_pitch_booking();

-- A renamed pitch renames its games' field label; a pitch with games still
-- to play cannot be removed.
create or replace function public.pitch_renamed()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.name is distinct from old.name then
    update public.fixtures set field_label = new.name where pitch_id = new.id;
  end if;
  return new;
end;
$fn$;
revoke execute on function public.pitch_renamed() from public, anon, authenticated;
drop trigger if exists pitches_renamed on public.pitches;
create trigger pitches_renamed after update of name on public.pitches
  for each row execute function public.pitch_renamed();

create or replace function public.pitch_in_use()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.fixtures f
              where f.pitch_id in (select app_private.pitch_family(old.id))
                and f.starts_at >= now() and f.status in ('scheduled', 'in_progress')) then
    raise exception '% has games still to play; move them first', old.name using errcode = '23P01';
  end if;
  return old;
end;
$fn$;
revoke execute on function public.pitch_in_use() from public, anon, authenticated;
drop trigger if exists pitches_in_use on public.pitches;
create trigger pitches_in_use before delete on public.pitches
  for each row execute function public.pitch_in_use();

-- ---------------------------------------------------------- the layout
-- A full pitch at the next free spot on the canvas (a 3 × 2 grid of
-- 28 × 42 pitches), named "Field N".
drop function if exists public.add_pitch(uuid, text);
create or replace function public.add_pitch(p_venue uuid, p_name text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_venue public.venues;
  v_id    uuid;
  v_n     integer;
  v_x     numeric;
  v_y     numeric;
  v_found boolean := false;
begin
  select * into v_venue from public.venues where id = p_venue;
  if v_venue.id is null or not coalesce(app_private.is_academy_staff(v_venue.academy_id), false) then
    raise exception 'only the club''s staff can lay out its grounds' using errcode = '42501';
  end if;
  select count(*) into v_n from public.pitches where venue_id = p_venue and parent_id is null;
  for v_y in select unnest(array[4, 54]) loop
    for v_x in select unnest(array[3, 36, 69]) loop
      if not v_found and not exists (
        select 1 from public.pitches p
         where p.venue_id = p_venue and p.parent_id is null
           and p.x < v_x + 28 and p.x + p.w > v_x and p.y < v_y + 42 and p.y + p.h > v_y
      ) then
        v_found := true;
        insert into public.pitches (academy_id, venue_id, name, size, x, y, w, h, sort)
        values (v_venue.academy_id, p_venue, coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Field ' || (v_n + 1)), 'full', v_x, v_y, 28, 42, v_n)
        returning id into v_id;
      end if;
    end loop;
  end loop;
  if not v_found then
    -- Seven or more: stacked at the origin; the owner drags it somewhere.
    insert into public.pitches (academy_id, venue_id, name, size, x, y, w, h, sort)
    values (v_venue.academy_id, p_venue, coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Field ' || (v_n + 1)), 'full', 0, 0, 28, 42, v_n)
    returning id into v_id;
  end if;
  return v_id;
end;
$fn$;
revoke execute on function public.add_pitch(uuid, text) from public, anon;
grant execute on function public.add_pitch(uuid, text) to authenticated;

-- Cut a full pitch into halves (2), thirds (3) or quarters (4): the halves
-- and thirds across the long side, the quarters two by two. Named 1A, 1B…
-- Any earlier cut is replaced; a cut with games still to play is refused
-- by the delete trigger.
drop function if exists public.split_pitch(uuid, integer);
create or replace function public.split_pitch(p_pitch uuid, p_into integer)
returns integer language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_p     public.pitches;
  v_size  text;
  v_i     integer;
  v_tag   text;
  v_base  text;
  v_cw    numeric;
  v_ch    numeric;
  v_x     numeric;
  v_y     numeric;
  v_long  boolean;
begin
  select * into v_p from public.pitches where id = p_pitch;
  if v_p.id is null or not coalesce(app_private.is_academy_staff(v_p.academy_id), false) then
    raise exception 'only the club''s staff can lay out its grounds' using errcode = '42501';
  end if;
  if v_p.parent_id is not null then
    raise exception 'a sub-pitch cannot be cut again; cut the full pitch' using errcode = '22023';
  end if;
  if p_into not in (2, 3, 4) then
    raise exception 'a pitch is cut into halves, thirds or quarters' using errcode = '22023';
  end if;
  delete from public.pitches where parent_id = p_pitch;
  v_size := case p_into when 2 then 'half' when 3 then 'third' else 'quarter' end;
  v_base := regexp_replace(v_p.name, '^\D*', '');     -- "Field 1" → "1"
  if v_base = '' then v_base := v_p.name; end if;
  v_long := v_p.h >= v_p.w;
  for v_i in 0 .. p_into - 1 loop
    v_tag := chr(65 + v_i);
    if p_into = 4 then
      v_cw := v_p.w / 2; v_ch := v_p.h / 2;
      v_x := v_p.x + (v_i % 2) * v_cw; v_y := v_p.y + (v_i / 2) * v_ch;
    elsif v_long then
      v_cw := v_p.w; v_ch := v_p.h / p_into;
      v_x := v_p.x; v_y := v_p.y + v_i * v_ch;
    else
      v_cw := v_p.w / p_into; v_ch := v_p.h;
      v_x := v_p.x + v_i * v_cw; v_y := v_p.y;
    end if;
    insert into public.pitches (academy_id, venue_id, parent_id, name, size, x, y, w, h, sort)
    values (v_p.academy_id, v_p.venue_id, p_pitch, v_base || v_tag, v_size, round(v_x, 2), round(v_y, 2), round(v_cw, 2), round(v_ch, 2), v_p.sort * 10 + v_i);
  end loop;
  return p_into;
end;
$fn$;
revoke execute on function public.split_pitch(uuid, integer) from public, anon;
grant execute on function public.split_pitch(uuid, integer) to authenticated;

-- Dragged: the pitch and, if it is a full one, its sub-pitches with it.
-- Kept on the canvas.
drop function if exists public.move_pitch(uuid, numeric, numeric);
create or replace function public.move_pitch(p_pitch uuid, p_x numeric, p_y numeric)
returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_p  public.pitches;
  v_nx numeric;
  v_ny numeric;
begin
  select * into v_p from public.pitches where id = p_pitch;
  if v_p.id is null or not coalesce(app_private.is_academy_staff(v_p.academy_id), false) then
    raise exception 'only the club''s staff can lay out its grounds' using errcode = '42501';
  end if;
  v_nx := least(greatest(round(coalesce(p_x, v_p.x), 2), 0), 100 - v_p.w);
  v_ny := least(greatest(round(coalesce(p_y, v_p.y), 2), 0), 100 - v_p.h);
  update public.pitches set x = x + (v_nx - v_p.x), y = y + (v_ny - v_p.y) where parent_id = p_pitch;
  update public.pitches set x = v_nx, y = v_ny where id = p_pitch;
end;
$fn$;
revoke execute on function public.move_pitch(uuid, numeric, numeric) from public, anon;
grant execute on function public.move_pitch(uuid, numeric, numeric) to authenticated;

-- The hours, replaced whole: [{weekday, opens, closes}, …].
drop function if exists public.set_pitch_hours(uuid, jsonb);
create or replace function public.set_pitch_hours(p_pitch uuid, p_hours jsonb)
returns integer language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_p public.pitches;
  v_n integer;
begin
  select * into v_p from public.pitches where id = p_pitch;
  if v_p.id is null or not coalesce(app_private.is_academy_staff(v_p.academy_id), false) then
    raise exception 'only the club''s staff can set a pitch''s hours' using errcode = '42501';
  end if;
  delete from public.pitch_availability where pitch_id = p_pitch;
  insert into public.pitch_availability (academy_id, pitch_id, weekday, opens, closes)
  select v_p.academy_id, p_pitch, (h ->> 'weekday')::integer, (h ->> 'opens')::time, (h ->> 'closes')::time
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) h;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;
revoke execute on function public.set_pitch_hours(uuid, jsonb) from public, anon;
grant execute on function public.set_pitch_hours(uuid, jsonb) to authenticated;

-- The club's size rules, U6 … U18, defaults filled in; and setting them.
drop function if exists public.pitch_size_rules_for(uuid);
create or replace function public.pitch_size_rules_for(p_academy uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when coalesce(app_private.is_academy_member(p_academy), false) then coalesce((
    select jsonb_agg(jsonb_build_object(
             'age_group', 'U' || a, 'size', coalesce(r.size, app_private.default_pitch_size(a)),
             'is_default', r.size is null) order by a)
      from generate_series(6, 18) a
      left join public.pitch_size_rules r on r.academy_id = p_academy and r.age_group = 'U' || a
  ), '[]'::jsonb) end;
$$;
revoke execute on function public.pitch_size_rules_for(uuid) from public, anon;
grant execute on function public.pitch_size_rules_for(uuid) to authenticated;

drop function if exists public.set_pitch_size_rules(uuid, jsonb);
create or replace function public.set_pitch_size_rules(p_academy uuid, p_rules jsonb)
returns integer language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only the club''s staff can set its pitch sizes' using errcode = '42501';
  end if;
  delete from public.pitch_size_rules where academy_id = p_academy;
  insert into public.pitch_size_rules (academy_id, age_group, size)
  select p_academy, key, value #>> '{}'
    from jsonb_each(coalesce(p_rules, '{}'::jsonb))
   where key ~ '^U\d{1,2}$' and (value #>> '{}') in ('full', 'half', 'third', 'quarter');
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;
revoke execute on function public.set_pitch_size_rules(uuid, jsonb) from public, anon;
grant execute on function public.set_pitch_size_rules(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------- reading it
-- The venue drawn: pin, amenities, every pitch with its hours. Readable by
-- anyone signed in — a ground's layout is on the noticeboard at the gate —
-- never by a stranger with no account, and never written through here.
drop function if exists public.venue_layout(uuid);
create or replace function public.venue_layout(p_venue uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v public.venues;
begin
  if auth.uid() is null then
    raise exception 'sign in' using errcode = '42501';
  end if;
  select * into v from public.venues where id = p_venue;
  if v.id is null then return null; end if;
  return jsonb_build_object(
    'id', v.id, 'academy_id', v.academy_id, 'name', v.name, 'address', v.address, 'notes', v.notes,
    'lat', v.lat, 'lng', v.lng, 'amenities', v.amenities,
    'can_edit', coalesce(app_private.is_academy_staff(v.academy_id), false),
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'parent_id', p.parent_id, 'name', p.name, 'size', p.size,
               'x', p.x, 'y', p.y, 'w', p.w, 'h', p.h,
               'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI')) order by h.weekday, h.opens)
                                    from public.pitch_availability h where h.pitch_id = p.id), '[]'::jsonb))
             order by p.parent_id nulls first, p.sort, p.name)
        from public.pitches p where p.venue_id = p_venue), '[]'::jsonb)
  );
end;
$fn$;
revoke execute on function public.venue_layout(uuid) from public, anon;
grant execute on function public.venue_layout(uuid) to authenticated;

-- A game's ground, for the family: the layout with this game's pitch named.
drop function if exists public.fixture_pitch(uuid);
create or replace function public.fixture_pitch(p_fixture uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  f public.fixtures;
begin
  if auth.uid() is null then
    raise exception 'sign in' using errcode = '42501';
  end if;
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or f.venue_id is null then return null; end if;
  return public.venue_layout(f.venue_id)
      || jsonb_build_object('pitch_id', f.pitch_id, 'field_label', f.field_label, 'starts_at', f.starts_at);
end;
$fn$;
revoke execute on function public.fixture_pitch(uuid) from public, anon;
grant execute on function public.fixture_pitch(uuid) to authenticated;

-- --------------------------------------------------- the draw, on pitches
-- Build a division's draw on a venue's pitches of the right size, inside
-- their hours, around whatever is already booked. The pairs, the rounds and
-- "no team twice at once" are the existing generator's; this picks the
-- pitches, then fits each pitch's games into its windows per date and
-- steps past any slot the clash rule would refuse. What will not fit is
-- counted and left without a pitch, at its drawn time, for the organiser.
drop function if exists public.generate_fixtures_on_pitches(uuid, text, uuid, date, integer, integer, boolean, integer);
create or replace function public.generate_fixtures_on_pitches(
  p_competition uuid, p_division text, p_venue uuid, p_first_date date,
  p_game_mins integer default null, p_gap_mins integer default 5,
  p_replace boolean default false, p_round_every_days integer default 7
) returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_comp     public.competitions;
  v_venue    public.venues;
  v_size     text;
  v_tz       text;
  v_names    text[];
  v_ids      uuid[];
  v_game     integer;
  v_open     time;
  v_start    timestamptz;
  -- now(), not clock_timestamp(): the rows the generator inserts get
  -- created_at = now() (the transaction's start), and the fit below must
  -- see them and none from an earlier draw.
  v_t0       timestamptz := now();
  v_made     integer;
  v_placed   integer := 0;
  v_overflow integer := 0;
  v_pitch    uuid;
  v_day      date;
  v_fx       record;
  v_cursor   timestamptz;
  v_slot     timestamptz;
  v_end      timestamptz;
  v_fits     boolean;
  v_tries    integer;
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  select * into v_comp from public.competitions where id = p_competition;
  select * into v_venue from public.venues where id = p_venue;
  if v_venue.id is null or not (
    v_venue.academy_id = v_comp.organiser_id
    or exists (select 1 from public.competition_clubs cc where cc.competition_id = p_competition and cc.academy_id = v_venue.academy_id)
  ) then
    raise exception 'that venue is not the league''s or an entered club''s' using errcode = '22023';
  end if;
  v_tz   := app_private.competition_tz(p_competition);
  v_size := app_private.division_pitch_size(p_competition, p_division);
  select coalesce(array_agg(p.name order by p.sort, p.name), '{}'), coalesce(array_agg(p.id order by p.sort, p.name), '{}')
    into v_names, v_ids
    from public.pitches p where p.venue_id = p_venue and p.size = v_size;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'No %-size pitches at %. In Venues, % a full pitch.', v_size, v_venue.name,
      case v_size when 'full' then 'add' when 'half' then 'cut in halves' when 'third' then 'cut in thirds' else 'cut in quarters' end
      using errcode = '22023';
  end if;
  v_game := coalesce(p_game_mins,
              (select d.match_length_mins from public.competition_divisions d where d.competition_id = p_competition and d.division = p_division),
              40);

  -- Kick-off: the earliest these pitches open on that weekday, else 8am.
  select min(h.opens) into v_open
    from public.pitch_availability h
   where (h.pitch_id = any (v_ids) or h.pitch_id in (select parent_id from public.pitches where id = any (v_ids)))
     and h.weekday = extract(dow from p_first_date)::integer;
  v_start := (p_first_date::text || ' ' || coalesce(v_open, '08:00'::time)::text)::timestamp at time zone v_tz;

  v_made := public.generate_fixtures(p_competition, p_division, v_start, v_game, coalesce(p_gap_mins, 5),
                                     v_names, v_venue.name, p_replace, coalesce(p_round_every_days, 7));

  -- Now fit: per pitch, per date, in drawn order.
  for v_pitch in select unnest(v_ids) loop
    for v_day in
      select distinct (f.starts_at at time zone v_tz)::date
        from public.fixtures f
       where f.competition_id = p_competition and f.division = p_division
         and f.pitch_id is null and f.created_at >= v_t0
         and f.field_label = (select name from public.pitches where id = v_pitch)
       order by 1
    loop
      v_cursor := null;
      for v_fx in
        select f.id, f.starts_at, coalesce(f.duration_mins, v_game) as mins
          from public.fixtures f
         where f.competition_id = p_competition and f.division = p_division
           and f.pitch_id is null and f.created_at >= v_t0
           and f.field_label = (select name from public.pitches where id = v_pitch)
           and (f.starts_at at time zone v_tz)::date = v_day
         order by f.starts_at
      loop
        v_slot := coalesce(v_cursor, v_fx.starts_at);
        v_fits := false;
        v_tries := 0;
        while not v_fits and v_tries < 60 loop
          v_end := v_slot + make_interval(mins => v_fx.mins);
          if (v_end at time zone v_tz)::date <> v_day then
            exit;
          end if;
          if app_private.pitch_open(v_pitch, v_slot, v_end)
             and app_private.pitch_clash(v_pitch, v_slot, v_end, v_fx.id) is null then
            v_fits := true;
          else
            v_slot := v_slot + make_interval(mins => v_fx.mins + coalesce(p_gap_mins, 5));
            v_tries := v_tries + 1;
          end if;
        end loop;
        if v_fits then
          update public.fixtures set starts_at = v_slot, pitch_id = v_pitch, updated_at = now() where id = v_fx.id;
          v_placed := v_placed + 1;
          v_cursor := v_slot + make_interval(mins => v_fx.mins + coalesce(p_gap_mins, 5));
        else
          v_overflow := v_overflow + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('games', v_made, 'placed', v_placed, 'overflow', v_overflow,
                            'size', v_size, 'pitches', to_jsonb(v_names), 'venue', v_venue.name);
end;
$fn$;
revoke execute on function public.generate_fixtures_on_pitches(uuid, text, uuid, date, integer, integer, boolean, integer) from public, anon;
grant execute on function public.generate_fixtures_on_pitches(uuid, text, uuid, date, integer, integer, boolean, integer) to authenticated;

-- ----------------------------------------------------- washouts, by pitch
-- 0156's call-off, now able to take one pitch — a waterlogged Field 2 while
-- Field 1 plays. A full pitch takes its sub-pitches with it, and a sub-pitch
-- its parent (the rule is the booking rule).
drop function if exists public.call_off_fixtures(uuid, date, text, text, boolean, text);
drop function if exists public.call_off_fixtures(uuid, date, text, text, boolean, text, uuid);
create or replace function public.call_off_fixtures(
  p_competition uuid, p_date date, p_reason text,
  p_venue text default null, p_cancel boolean default false, p_note text default null,
  p_pitch uuid default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_zone  text;
  v_from  timestamptz;
  v_to    timestamptz;
  v_n     integer;
  v_names text[];
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can call games off' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;
  v_zone := app_private.competition_tz(p_competition);
  v_from := (p_date::timestamp at time zone v_zone);
  v_to   := ((p_date + 1)::timestamp at time zone v_zone);

  with hit as (
    update public.fixtures f
       set status = case when p_cancel then 'cancelled' else 'postponed' end::public.fixture_status,
           cancel_reason = p_reason,
           notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), f.notes),
           updated_at = now()
     where f.competition_id = p_competition
       and f.starts_at >= v_from and f.starts_at < v_to
       and f.status in ('scheduled', 'in_progress')
       and (p_venue is null
            or coalesce(f.venue_label, (select v.name from public.venues v where v.id = f.venue_id), '') ilike '%' || btrim(p_venue) || '%')
       and (p_pitch is null or f.pitch_id in (select app_private.pitch_family(p_pitch)))
    returning coalesce((select h.display_name from public.competition_entries h where h.id = f.home_entry_id), '?')
              || ' v ' || coalesce((select a.display_name from public.competition_entries a where a.id = f.away_entry_id), '?') as game
  )
  select count(*), coalesce(array_agg(game), '{}') into v_n, v_names from hit;

  return jsonb_build_object('affected', v_n, 'games', to_jsonb(v_names),
                            'status', case when p_cancel then 'cancelled' else 'postponed' end);
end;
$fn$;
revoke execute on function public.call_off_fixtures(uuid, date, text, text, boolean, text, uuid) from public, anon;
grant execute on function public.call_off_fixtures(uuid, date, text, text, boolean, text, uuid) to authenticated;

-- 0099: who actually turned up.
--
-- RSVPs are an INTENTION, recorded days earlier by a parent. Attendance is a
-- FACT, recorded at the ground by a coach, and they are different enough that
-- conflating them would make both useless: a child marked "going" who did not
-- come is the single most useful row in an academy's data, and there was
-- nowhere to put it.
--
-- This is the thing an academy does more than anything else. NRIFA has 78
-- training sessions a term; the register is taken at every one of them, and
-- today it is taken on paper or not at all. It is also table stakes in
-- DRIBL_INTEL's own list ("attendance exports") and something Dribl does not
-- do for training at all — its match sheets are a federation function about
-- eligibility, not a coach counting heads on a Tuesday.
--
-- DESIGN. One row per child per event, and no row at all when the register
-- has not been taken — so "nobody came" and "nobody marked it" are
-- distinguishable, which matters when you are chasing a coach for a register
-- rather than chasing a family for a child.
--
-- Marked by COACHES, not parents. A parent saying their child was present is
-- a different claim from a coach saying it, and only one of them is a record.

do $$ begin
  create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');
exception when duplicate_object then null; end $$;

create table if not exists public.event_attendance (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  event_id   uuid not null,
  player_id  uuid not null,
  status     public.attendance_status not null,
  -- "Left early, ankle" — the thing a coach says out loud and nobody records.
  note       text,

  marked_by  uuid references public.profiles(id) on delete set null,
  marked_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One answer per child per session. Correcting it updates the row; a second
  -- opinion is not a thing a register has.
  constraint event_attendance_once unique (event_id, player_id),

  constraint event_attendance_id_academy_key unique (id, academy_id),
  constraint event_attendance_event_fkey foreign key (event_id, academy_id)
    references public.events (id, academy_id) on delete cascade,
  constraint event_attendance_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);

create index if not exists event_attendance_event_idx on public.event_attendance (event_id);
create index if not exists event_attendance_player_idx
  on public.event_attendance (player_id, marked_at desc);

alter table public.event_attendance enable row level security;

-- A guardian sees their own child's record, and coaches of the academy see
-- the register. A parent seeing the whole register would be a list of which
-- children were absent, which is nobody else's business.
create policy event_attendance_select on public.event_attendance
  for select to authenticated
  using (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_coach(academy_id))
  );

create policy event_attendance_insert on public.event_attendance
  for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)));

create policy event_attendance_update on public.event_attendance
  for update to authenticated
  using ((select app_private.is_academy_coach(academy_id)))
  with check ((select app_private.is_academy_coach(academy_id)));

create policy event_attendance_delete on public.event_attendance
  for delete to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

create trigger event_attendance_set_updated_at
  before update on public.event_attendance
  for each row execute function public.set_updated_at();

/**
 * The register for one session: every child who should be there, and whatever
 * has been marked so far.
 *
 * A LEFT JOIN from the roster, not from the attendance table, because the
 * question a coach is answering is "who is in front of me" and the answer has
 * to include the children nobody has marked yet. Returning only marked rows
 * would make an unmarked register look like an empty squad.
 *
 * Carries the RSVP alongside, because the two together are what a coach
 * actually wants: the four who said yes and did not come are the conversation
 * to have.
 */
create or replace function public.event_register(p_event uuid)
returns table (
  player_id   uuid,
  player_name text,
  squad_number integer,
  status      public.attendance_status,
  note        text,
  rsvp        text
)
language sql stable security definer set search_path = public as $fn$
  select pl.id,
         coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name),
         (select sn.number from public.squad_numbers sn
           where sn.player_id = pl.id
           order by sn.created_at desc limit 1),
         a.status,
         a.note,
         (select r.status::text from public.event_rsvps r
           where r.event_id = e.id and r.player_id = pl.id limit 1)
    from public.events e
    join public.players pl
      on pl.academy_id = e.academy_id
     and (e.team_id is null or pl.team_id = e.team_id)
    left join public.event_attendance a
      on a.event_id = e.id and a.player_id = pl.id
   where e.id = p_event
     and (select app_private.is_academy_coach(e.academy_id))
   order by coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name);
$fn$;

revoke execute on function public.event_register(uuid) from public, anon;
grant execute on function public.event_register(uuid) to authenticated;

/**
 * Take the register in one call.
 *
 * A coach marks a whole squad at once — they are standing on a pitch, not
 * filling in a form per child — so this takes the lot and returns how many it
 * wrote. One round trip instead of seventeen, which matters on a phone with
 * two bars at a ground.
 *
 * `p_marks` is [{player_id, status, note}]. Anything not in the array is left
 * alone rather than cleared, so marking the three late arrivals afterwards
 * does not wipe the fourteen already marked present.
 */
create or replace function public.take_register(p_event uuid, p_marks jsonb)
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_team    uuid;
  v_count   integer := 0;
  v_mark    jsonb;
begin
  select academy_id, team_id into v_academy, v_team
    from public.events where id = p_event;

  if v_academy is null then
    raise exception 'no such event' using errcode = '22023';
  end if;
  if not app_private.is_academy_coach(v_academy) then
    raise exception 'only a coach can take the register' using errcode = '42501';
  end if;
  if jsonb_typeof(p_marks) <> 'array' then
    raise exception 'marks must be an array' using errcode = '22023';
  end if;

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    -- Every child must be in this academy, and in this event's team if it has
    -- one. Without this a coach could mark a child from another squad — or,
    -- with a crafted call, another academy — into this register.
    if not exists (
      select 1 from public.players pl
       where pl.id = (v_mark->>'player_id')::uuid
         and pl.academy_id = v_academy
         and (v_team is null or pl.team_id = v_team)
    ) then
      raise exception 'player % is not in this squad', v_mark->>'player_id'
        using errcode = '42501';
    end if;

    insert into public.event_attendance (
      academy_id, event_id, player_id, status, note, marked_by
    ) values (
      v_academy, p_event,
      (v_mark->>'player_id')::uuid,
      (v_mark->>'status')::public.attendance_status,
      nullif(btrim(coalesce(v_mark->>'note', '')), ''),
      auth.uid()
    )
    on conflict (event_id, player_id) do update
      set status = excluded.status,
          note = excluded.note,
          marked_by = excluded.marked_by,
          marked_at = now(),
          updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

revoke execute on function public.take_register(uuid, jsonb) from public, anon;
grant execute on function public.take_register(uuid, jsonb) to authenticated;

/**
 * A player's attendance over a window — the thing an academy is actually
 * paying for.
 *
 * "Fourteen of sixteen sessions" is what a coach says at a parent meeting and
 * what a parent wants to hear before they re-register. Counted over sessions
 * that were NOT called off, because a wet-weather cancellation is not a
 * child's absence and counting it as one would quietly punish families for
 * the weather.
 */
create or replace function public.attendance_summary(
  p_academy uuid,
  p_from    date default null,
  p_team    uuid default null
)
returns table (
  player_id   uuid,
  player_name text,
  sessions    integer,
  present     integer,
  late        integer,
  absent      integer,
  excused     integer,
  unmarked    integer,
  rate        numeric
)
language sql stable security definer set search_path = public as $fn$
  with window_events as (
    select e.id, e.team_id
      from public.events e
     where e.academy_id = p_academy
       and e.cancelled_at is null
       and e.starts_at < now()
       and e.starts_at >= coalesce(p_from, current_date - interval '120 days')
       and (p_team is null or e.team_id = p_team)
  )
  select pl.id,
         coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name),
         count(we.id)::integer,
         count(*) filter (where a.status = 'present')::integer,
         count(*) filter (where a.status = 'late')::integer,
         count(*) filter (where a.status = 'absent')::integer,
         count(*) filter (where a.status = 'excused')::integer,
         count(*) filter (where a.status is null)::integer,
         -- Late still turned up. A rate that treats a late arrival as an
         -- absence is a rate no coach would recognise.
         case when count(*) filter (where a.status is not null) = 0 then null
              else round(
                100.0 * count(*) filter (where a.status in ('present', 'late'))
                      / count(*) filter (where a.status is not null), 0)
         end
    from public.players pl
    join window_events we
      on (we.team_id is null or pl.team_id = we.team_id)
    left join public.event_attendance a
      on a.event_id = we.id and a.player_id = pl.id
   where pl.academy_id = p_academy
     and (p_team is null or pl.team_id = p_team)
     and (select app_private.is_academy_coach(p_academy))
   group by pl.id, pl.preferred_name, pl.full_name
   order by coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name);
$fn$;

revoke execute on function public.attendance_summary(uuid, date, uuid) from public, anon;
grant execute on function public.attendance_summary(uuid, date, uuid) to authenticated;

-- 0106: let people arrange their own home screen.
--
-- The home screen has been two things on principle — what is coming up, and
-- the rooms you are in — and that principle was right while the product had
-- two things worth showing. It now has competitions with live ladders, a
-- register, outstanding fees, a month of fixtures and the Needs You strip,
-- and a coach and a parent want different ones of those at the top.
--
-- The fixed layout was also hiding Competitions two taps deep under Admin,
-- for a product whose pitch includes running a league better than Dribl
-- does. An editable home screen fixes both at once: Competitions becomes
-- something you can put on it.
--
-- WHAT THIS REPLACES. 0010 added `home_order`, a two-way toggle between
-- 'events' and 'chats' that nothing ever read — the first attempt at this
-- idea, sized for a product with two sections. It stays on the table
-- untouched rather than being dropped: nothing reads it, so nothing breaks,
-- and a column drop on a live table is a bigger act than a column nobody
-- uses deserves.
--
-- DEFAULTS BY ROLE, not one default for everybody. A parent opening this app
-- wants what their children are doing; a coach wants what is waiting on
-- them. Neither should have to arrange the screen before it is useful, and
-- somebody who never opens the editor should never notice it exists.
--
-- The LIST of valid sections lives here as a check constraint rather than
-- only in the client, because a layout is stored data and a typo saved once
-- is a broken home screen until somebody edits it again.

alter table public.user_settings
  add column if not exists home_sections jsonb;

comment on column public.user_settings.home_sections is
  'Ordered array of section ids for this person''s home screen, or null for
   the role default. Supersedes home_order, which nothing reads.';

/**
 * Is this a layout we can render?
 *
 * A function because a CHECK may not contain a subquery, and walking an array
 * needs one. Immutable so the constraint may call it.
 */
create or replace function app_private.home_sections_ok(p_sections jsonb)
returns boolean
language sql immutable as $fn$
  select p_sections is null
      or (
        jsonb_typeof(p_sections) = 'array'
        -- A home screen with more sections than this is a menu, and there is
        -- a tab bar for that.
        and jsonb_array_length(p_sections) <= 8
        and not exists (
          select 1
            from jsonb_array_elements_text(p_sections) s
           where s not in ('needs', 'upcoming', 'calendar', 'chats', 'competitions', 'owing')
        )
      );
$fn$;

do $$ begin
  alter table public.user_settings
    add constraint user_settings_home_sections_known
    check (app_private.home_sections_ok(home_sections));
exception when duplicate_object then null; end $$;

/**
 * The layout to render, stored or default.
 *
 * Resolved here rather than in the client so the two cannot disagree about
 * what a new person sees — and so a section added in a later migration can be
 * given to everybody who has not customised anything, without shipping a new
 * app bundle.
 *
 * `editable` comes back too: the editor needs to know which sections this
 * person is even allowed, and "who owes money" is not a parent's to arrange.
 */
create or replace function public.home_layout(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_academy  uuid;
  v_stored   jsonb;
  v_is_staff boolean := false;
  v_is_admin boolean := false;
  v_sections jsonb;
begin
  if v_me is null then return null; end if;
  v_academy := app_private.my_academy(p_academy);

  if v_academy is not null then
    v_is_staff := app_private.is_academy_coach(v_academy);
    v_is_admin := app_private.is_academy_staff(v_academy);
  end if;

  select home_sections into v_stored from public.user_settings where profile_id = v_me;

  if v_stored is not null then
    v_sections := v_stored;
  elsif v_is_admin then
    -- Somebody running a club opens this to find out what is waiting on them
    -- and who has not paid.
    v_sections := '["needs","upcoming","owing","chats","competitions"]'::jsonb;
  elsif v_is_staff then
    v_sections := '["needs","upcoming","chats","competitions"]'::jsonb;
  else
    -- A parent wants what their children are doing. No competitions by
    -- default: a ladder is interesting, and it is not why they opened the app.
    v_sections := '["needs","upcoming","chats"]'::jsonb;
  end if;

  -- A stored layout can outlive the role that justified it — somebody who
  -- stops being an admin keeps their saved list, and "who owes money" would
  -- then render an error rather than nothing. Filtered on the way out, not on
  -- the way in, so the section comes back if they are made an admin again.
  if not v_is_admin then
    select jsonb_agg(s) into v_sections
      from jsonb_array_elements_text(v_sections) s
     where s <> 'owing';
  end if;

  return jsonb_build_object(
    'sections', coalesce(v_sections, '["upcoming","chats"]'::jsonb),
    'customised', v_stored is not null,
    'available', case
      when v_is_admin then '["needs","upcoming","calendar","chats","competitions","owing"]'::jsonb
      else '["needs","upcoming","calendar","chats","competitions"]'::jsonb
    end
  );
end;
$fn$;

revoke execute on function public.home_layout(uuid) from public, anon;
grant execute on function public.home_layout(uuid) to authenticated;

/**
 * Save a layout, or pass null to go back to the role default.
 *
 * Upserts user_settings because a person may never have had a row — every
 * other setting on that table is written the same way.
 */
create or replace function public.set_home_sections(p_sections jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not app_private.home_sections_ok(p_sections) then
    raise exception 'that is not a layout this app can render' using errcode = '22023';
  end if;

  insert into public.user_settings (profile_id, home_sections)
  values (v_me, p_sections)
  on conflict (profile_id) do update
    set home_sections = excluded.home_sections,
        updated_at = now();

  return public.home_layout(null);
end;
$fn$;

revoke execute on function public.set_home_sections(jsonb) from public, anon;
grant execute on function public.set_home_sections(jsonb) to authenticated;

/**
 * A month of dates that have something on them, for the calendar section.
 *
 * Deliberately tiny: a date and a count, nothing else. A month grid needs to
 * know which squares to mark, and shipping forty events to draw forty dots
 * would make the lightest section on the screen the most expensive.
 *
 * Grouped in the ACADEMY's timezone, so a 9am Saturday game marks Saturday
 * rather than the Friday it is in UTC.
 */
create or replace function public.month_dots(
  p_academy uuid default null,
  p_month   date default null
)
returns table (on_date date, events integer, has_match boolean)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_zone    text;
  v_from    date;
begin
  if auth.uid() is null then return; end if;
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then return; end if;

  select timezone into v_zone from public.academies where id = v_academy;
  v_from := date_trunc('month', coalesce(p_month, current_date))::date;

  return query
  select (e.starts_at at time zone v_zone)::date as on_date,
         count(*)::integer,
         bool_or(e.type = 'match')
    from public.my_upcoming_events(v_academy, 400) e
   where (e.starts_at at time zone v_zone)::date >= v_from
     and (e.starts_at at time zone v_zone)::date < (v_from + interval '1 month')::date
   group by 1
   order by 1;
end;
$fn$;

revoke execute on function public.month_dots(uuid, date) from public, anon;
grant execute on function public.month_dots(uuid, date) to authenticated;

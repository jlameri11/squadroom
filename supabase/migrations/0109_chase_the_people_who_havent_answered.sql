-- 0109: E-03 and C-01. Chasing the six families who have not answered.
--
-- This is the most tedious thing in running a squad and the job the product
-- was not doing. A coach needs eleven players on Saturday, has nine answers,
-- and the current options are scrolling a WhatsApp group counting names or
-- texting people individually. Spond's own notification overload is the
-- cautionary tale here: the answer is not "remind everybody again", it is
-- "remind exactly the people who have not answered".
--
-- TWO THINGS, ONE MECHANISM.
--
--   E-03: who has not RSVP'd to a fixture, and nudge them.
--   C-01: who has not SEEN an announcement, and re-ping them.
--
-- Both are "find the people this did not reach, and reach them". Sharing the
-- enqueue path means a nudge obeys quiet hours and a person's opt-out the
-- same way every other notification does.
--
-- ENQUEUED IN THE DATABASE, never by a client. CLAUDE.md: a client that
-- forgets would silently stop notifying anyone, and a nudge sent from a
-- browser could be sent a hundred times. These are security-definer
-- functions a coach calls; the client decides WHEN, never WHO or WHAT.
--
-- RATE LIMITED BY dedupe_key, at one nudge per person per event per day. A
-- coach who is not sure it worked will press it again — that is the same
-- lesson as 0101's "second press affects nothing" — and a family nudged five
-- times about one game is a family who turns notifications off.

/**
 * Who has not answered for a fixture.
 *
 * One row per CHILD, not per guardian: a parent with two children in the
 * squad has answered for one and not the other, and "Sam Whitfield" in a
 * chase list tells a coach nothing about which.
 *
 * Coaches of the event only. A parent seeing who else has not answered is a
 * list of which families are disorganised.
 */
create or replace function public.who_hasnt_answered(p_event uuid)
returns table (
  player_id    uuid,
  player_name  text,
  guardian_id  uuid,
  guardian_name text,
  guardian_phone text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then return; end if;

  if not app_private.is_event_coach(p_event) then
    raise exception 'only a coach of this fixture can see who has not answered'
      using errcode = '42501';
  end if;

  return query
  select pl.id,
         coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name),
         pg.profile_id,
         gp.full_name,
         gp.phone::text
    from public.players pl
    left join lateral (
      select g.profile_id
        from public.player_guardians g
       where g.player_id = pl.id
       order by g.is_primary desc nulls last, g.created_at
       limit 1
    ) pg on true
    left join public.profiles gp on gp.id = pg.profile_id
   where pl.academy_id = v_event.academy_id
     and (v_event.team_id is null or pl.team_id = v_event.team_id)
     and not exists (
       select 1 from public.event_rsvps r
        where r.event_id = p_event and r.player_id = pl.id
     )
   order by gp.full_name nulls last,
            coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name);
end;
$fn$;

revoke execute on function public.who_hasnt_answered(uuid) from public, anon;
grant execute on function public.who_hasnt_answered(uuid) to authenticated;

/**
 * Nudge them. Returns how many were actually told.
 *
 * "Actually" matters: the number excludes anybody already nudged today and
 * anybody who has turned event reminders off, so a coach pressing this twice
 * sees 6 and then 0 rather than 6 and 6. A number that lies about what
 * happened is worse than no number.
 */
create or replace function public.nudge_non_responders(p_event uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_event   public.events;
  v_academy public.academies;
  v_team    text;
  v_sent    integer;
  v_total   integer;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    raise exception 'no such fixture' using errcode = '22023';
  end if;
  if not app_private.is_event_coach(p_event) then
    raise exception 'only a coach of this fixture can chase it' using errcode = '42501';
  end if;
  if v_event.cancelled_at is not null then
    raise exception 'that fixture is called off' using errcode = '22023';
  end if;
  if v_event.starts_at < now() then
    raise exception 'that fixture has already started' using errcode = '22023';
  end if;

  select * into v_academy from public.academies where id = v_event.academy_id;
  select name into v_team from public.teams where id = v_event.team_id;

  select count(distinct guardian_id) into v_total
    from public.who_hasnt_answered(p_event)
   where guardian_id is not null;

  with targets as (
    select distinct guardian_id
      from public.who_hasnt_answered(p_event)
     where guardian_id is not null
  ),
  queued as (
    insert into public.notification_queue
      (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
    select
      v_event.academy_id, t.guardian_id, 'rsvp_nudge',
      coalesce(v_team, v_academy.name),
      -- Says which game and when, because "please answer" with no fixture in
      -- it makes somebody open the app to find out what it is about.
      'Can ' || coalesce(v_team, 'your child') || ' count on you for ' || v_event.title ||
        ' on ' || to_char(v_event.starts_at at time zone v_academy.timezone, 'FMDay FMDD FMMon') || '?',
      '/calendar/' || p_event,
      jsonb_build_object('event_id', p_event, 'nudge', true),
      -- Quiet hours hold it until morning. A nudge at eleven at night is
      -- exactly the notification that gets an app muted, and the answer is
      -- not needed tonight.
      case
        when us.quiet_hours_enabled
         and (public.zone_time(v_academy.timezone) >= us.quiet_hours_start
              or public.zone_time(v_academy.timezone) < us.quiet_hours_end)
        then ((current_date + 1) + us.quiet_hours_end) at time zone v_academy.timezone
        else now()
      end,
      -- One per person per event per DAY. A coach who is not sure it worked
      -- will press it again.
      'nudge:' || p_event::text || ':' || t.guardian_id::text || ':' || current_date::text
    from targets t
    join public.user_settings us on us.profile_id = t.guardian_id
    where us.notify_reminder_24h
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_sent from queued;

  return jsonb_build_object(
    'sent', v_sent,
    'outstanding', v_total,
    -- So the screen can explain a smaller number than expected rather than
    -- looking broken.
    'skipped', v_total - v_sent
  );
end;
$fn$;

revoke execute on function public.nudge_non_responders(uuid) from public, anon;
grant execute on function public.nudge_non_responders(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- C-01: did the announcement actually land?
-- ---------------------------------------------------------------------------

/**
 * How far an announcement reached.
 *
 * "Seen by 41 of 56" is the number a coach wants before a Saturday, and it
 * is already derivable: `channel_members.last_read_at` moves when somebody
 * opens the channel, so anybody whose last read is after the message was
 * posted has had it in front of them.
 *
 * Honest about what it measures, and the screen says so: this is "opened the
 * conversation after it was posted", not "read the words". There is no
 * honest way to know the second, and pretending otherwise would have a coach
 * telling a parent they definitely saw something.
 */
create or replace function public.announcement_reach(p_message uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_msg    public.messages;
  v_total  integer;
  v_seen   integer;
  v_unseen jsonb;
begin
  select * into v_msg from public.messages where id = p_message;
  if v_msg.id is null or not app_private.is_channel_member(v_msg.channel_id) then
    return null;
  end if;

  -- Only a host sees the breakdown. Who has not opened a chat is not
  -- everybody's business, and a parent counting who ignored the coach is a
  -- different app.
  if not app_private.is_channel_host(v_msg.channel_id) then
    return null;
  end if;

  select count(*),
         count(*) filter (where cm.last_read_at is not null and cm.last_read_at >= v_msg.created_at)
    into v_total, v_seen
    from public.channel_members cm
   where cm.channel_id = v_msg.channel_id
     and cm.profile_id <> v_msg.sender_id;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.full_name)
                            order by p.full_name), '[]'::jsonb)
    into v_unseen
    from public.channel_members cm
    join public.profiles p on p.id = cm.profile_id
   where cm.channel_id = v_msg.channel_id
     and cm.profile_id <> v_msg.sender_id
     and (cm.last_read_at is null or cm.last_read_at < v_msg.created_at);

  return jsonb_build_object(
    'seen', v_seen,
    'total', v_total,
    'unseen', v_unseen
  );
end;
$fn$;

revoke execute on function public.announcement_reach(uuid) from public, anon;
grant execute on function public.announcement_reach(uuid) to authenticated;

/**
 * Re-ping the people an announcement has not reached.
 *
 * The same one-per-person-per-day limit as a fixture nudge, for the same
 * reason. An announcement is exempt from quiet hours by design (0046) — it is
 * the point of an announcement — and a RE-ping is not: the first one already
 * went out at the moment it mattered, and the second is a chase.
 */
create or replace function public.reping_unread(p_message uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_msg     public.messages;
  v_academy public.academies;
  v_sent    integer;
begin
  select * into v_msg from public.messages where id = p_message;
  if v_msg.id is null then
    raise exception 'no such message' using errcode = '22023';
  end if;
  if not app_private.is_channel_host(v_msg.channel_id) then
    raise exception 'only a host of this conversation can chase it' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'that message was deleted' using errcode = '22023';
  end if;

  select * into v_academy from public.academies where id = v_msg.academy_id;

  with queued as (
    insert into public.notification_queue
      (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
    select
      v_msg.academy_id, cm.profile_id, 'announcement_repeat',
      coalesce(c.name, v_academy.name),
      'Still waiting on you: ' || left(coalesce(v_msg.body, 'an announcement'), 120),
      '/chat/' || v_msg.channel_id,
      jsonb_build_object('channel_id', v_msg.channel_id, 'message_id', v_msg.id, 'repeat', true),
      case
        when us.quiet_hours_enabled
         and (public.zone_time(v_academy.timezone) >= us.quiet_hours_start
              or public.zone_time(v_academy.timezone) < us.quiet_hours_end)
        then ((current_date + 1) + us.quiet_hours_end) at time zone v_academy.timezone
        else now()
      end,
      'reping:' || v_msg.id::text || ':' || cm.profile_id::text || ':' || current_date::text
    from public.channel_members cm
    join public.channels c on c.id = cm.channel_id
    join public.user_settings us on us.profile_id = cm.profile_id
    where cm.channel_id = v_msg.channel_id
      and cm.profile_id <> v_msg.sender_id
      and (cm.last_read_at is null or cm.last_read_at < v_msg.created_at)
      and us.notify_announcements
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_sent from queued;

  return jsonb_build_object('sent', v_sent);
end;
$fn$;

revoke execute on function public.reping_unread(uuid) from public, anon;
grant execute on function public.reping_unread(uuid) to authenticated;

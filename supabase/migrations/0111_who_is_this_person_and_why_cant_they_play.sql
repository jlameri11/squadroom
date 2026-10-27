-- 0111: C-02 and E-02.
--
-- C-02 — WHO IS THIS PERSON. A team chat is twenty adults whose names mean
-- nothing to each other. "Sam Whitfield" is a stranger; "Leo's dad" is the
-- person you stood next to at training. DRIBL_INTEL lists this under the chat
-- gap nobody fills — "per-child filters, team labels" — and it is the single
-- cheapest thing that makes a club chat feel like a club rather than a group
-- of phone numbers.
--
-- WHAT THE LABEL MAY SAY, which is a privacy decision and not a formatting
-- one. In a TEAM channel it names the children this person has IN THAT TEAM:
-- everybody in that conversation can already read that squad's roster, so it
-- reveals nothing new. In an academy-wide channel it names no children at
-- all, only the role and the squads — because an academy-wide channel
-- contains families from every age group, and a child's name is not
-- academy-wide information just because their parent typed something.
--
-- E-02 — WHY CAN'T THEY PLAY. `event_rsvps.note` has existed since the
-- beginning and nothing ever asked for it. A coach with "4 out" and no
-- reasons cannot tell a wedding from a sulk, and the one piece of
-- information that changes what they do on Saturday is the one nobody was
-- prompted for. Required on 'no', and on nothing else: a reason for turning
-- UP is an interrogation.

/**
 * How to describe somebody in a conversation.
 *
 * Deliberately takes the CHANNEL, not just the academy, because what may be
 * said about a person depends on who is listening. See the note above.
 */
create or replace function app_private.channel_member_label(
  p_channel uuid,
  p_profile uuid
)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_channel public.channels;
  v_role    public.academy_role;
  v_kids    text;
  v_teams   text;
begin
  select * into v_channel from public.channels where id = p_channel;
  if v_channel.id is null then return null; end if;

  select role into v_role
    from public.academy_members
   where academy_id = v_channel.academy_id and profile_id = p_profile and status = 'active';

  -- Staff are described by what they do. "Coach" is the most useful thing
  -- anybody can know about a person in a club chat.
  if v_role in ('owner', 'admin', 'coach') then
    -- A coach of THIS team says so; a coach of another age group is still a
    -- coach, and saying which team would be noise in their own channel.
    if v_channel.team_id is not null
       and exists (
         select 1 from public.team_members tm
          where tm.team_id = v_channel.team_id
            and tm.profile_id = p_profile
            and tm.role = 'coach'
       ) then
      return 'Coach';
    end if;
    return case v_role when 'coach' then 'Coach' else 'Club admin' end;
  end if;

  if v_channel.team_id is not null then
    -- Their children in this squad. Everybody here can read the roster, so
    -- this is not new information — it is the roster, attached to a name.
    select string_agg(
             coalesce(nullif(btrim(pl.preferred_name), ''), split_part(pl.full_name, ' ', 1)),
             ' & ' order by pl.full_name
           )
      into v_kids
      from public.players pl
      join public.player_guardians pg
        on pg.player_id = pl.id and pg.profile_id = p_profile
     where pl.academy_id = v_channel.academy_id
       and pl.team_id = v_channel.team_id;

    if v_kids is not null then
      -- `relationship` is free text a family typed — "Mum", "dad", "Nan" —
      -- so it is used as given and lower-cased, never guessed at. A missing
      -- one falls back to the neutral word rather than inventing a parent.
      return v_kids || '''s ' || coalesce(
        (select lower(btrim(pg.relationship))
           from public.player_guardians pg
           join public.players pl
             on pl.id = pg.player_id and pl.team_id = v_channel.team_id
          where pg.profile_id = p_profile
            and nullif(btrim(pg.relationship), '') is not null
          limit 1),
        'guardian'
      );
    end if;
    return null;
  end if;

  -- Academy-wide: the squads they are in, and no children named.
  select string_agg(t.name, ', ' order by t.name) into v_teams
    from public.team_members tm
    join public.teams t on t.id = tm.team_id and t.status = 'active'
   where tm.academy_id = v_channel.academy_id and tm.profile_id = p_profile;

  return v_teams;
end;
$fn$;

-- Adding a column to the return type means a DROP: `create or replace`
-- cannot change a function's signature. In the same migration, so it runs
-- inside one transaction and there is no moment where chat has no reader.
drop function if exists public.channel_messages(uuid, timestamptz, integer);

/**
 * channel_messages, now saying who each person is.
 *
 * Rebuilt rather than wrapped: this is the hottest read in the product and a
 * wrapper would mean two passes over the same rows. The column list is
 * otherwise unchanged from 0045 — and that is checked deliberately, because
 * 0071 replaced this function and silently dropped a column for three weeks.
 */
create function public.channel_messages(
  p_channel uuid,
  p_before  timestamptz default null,
  p_limit   integer default 50
)
returns table (
  id           uuid,
  body         text,
  attachments  jsonb,
  sender_id    uuid,
  sender_name  text,
  sender_role  public.academy_role,
  sender_label text,
  reply_to_id  uuid,
  reply_to_body text,
  reply_to_name text,
  is_announcement boolean,
  pinned_at    timestamptz,
  created_at   timestamptz,
  edited_at    timestamptz,
  deleted_at   timestamptz,
  event_id     uuid,
  event        jsonb,
  poll_id      uuid,
  poll         jsonb
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    -- A deleted message leaves a tombstone, never its text.
    case when m.deleted_at is null then m.body else null end,
    case when m.deleted_at is null then m.attachments else '[]'::jsonb end,
    m.sender_id,
    p.full_name,
    am.role,
    app_private.channel_member_label(p_channel, m.sender_id),
    m.reply_to_id,
    case when r.deleted_at is null then r.body else null end,
    rp.full_name,
    m.is_announcement,
    m.pinned_at,
    m.created_at,
    m.edited_at,
    m.deleted_at,
    m.event_id,
    case when m.event_id is null then null else (
      select to_jsonb(e) from (
        select ev.id, ev.title, ev.type, ev.starts_at, ev.ends_at, ev.arrive_at,
               ev.venue, ev.address, ev.opponent, ev.kit_colour, ev.cancelled_at
          from public.events ev where ev.id = m.event_id
      ) e
    ) end,
    m.poll_id,
    case when m.poll_id is null then null else (
      select to_jsonb(q) from (
        select po.id, po.question, po.options, po.type, po.multi, po.anonymous,
               po.closes_at, po.closed_at
          from public.polls po where po.id = m.poll_id
      ) q
    ) end
  from public.messages m
  left join public.profiles p on p.id = m.sender_id
  left join public.academy_members am
    on am.academy_id = m.academy_id and am.profile_id = m.sender_id
  left join public.messages r on r.id = m.reply_to_id
  left join public.profiles rp on rp.id = r.sender_id
  where m.channel_id = p_channel
    and m.status = 'published'
    and (p_before is null or m.created_at < p_before)
    and (select app_private.is_channel_member(p_channel))
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

revoke execute on function public.channel_messages(uuid, timestamptz, integer)
  from public, anon;
grant execute on function public.channel_messages(uuid, timestamptz, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- E-02: a reason when somebody cannot play
-- ---------------------------------------------------------------------------

/**
 * "Can't play" needs a reason. Nothing else does.
 *
 * A coach looking at "4 out" cannot tell a wedding from a sulk, and the one
 * piece of information that changes what they do on Saturday is the one
 * nobody was ever prompted for.
 *
 * Only on 'no'. A reason for turning UP is an interrogation, and a product
 * that asks for one is a product parents start lying to.
 *
 * Enforced here rather than only in the form, because the RSVP can be set
 * from the home screen, the event screen and a chat card, and a rule in three
 * places is a rule in none.
 */
create or replace function public.require_a_reason()
returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.status = 'no' and nullif(btrim(coalesce(new.note, '')), '') is null then
    raise exception 'Say why they cannot play — the coach needs to know'
      using errcode = '22023';
  end if;

  -- Changing away from 'no' clears the reason: a note saying "away at a
  -- wedding" sitting next to "in" is worse than no note.
  if new.status <> 'no' and old is not null and old.status = 'no' then
    new.note := nullif(btrim(coalesce(new.note, '')), '');
  end if;

  return new;
end;
$fn$;

drop trigger if exists event_rsvps_require_reason on public.event_rsvps;
create trigger event_rsvps_require_reason
  before insert or update on public.event_rsvps
  for each row execute function public.require_a_reason();

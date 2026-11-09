-- 0235: the league and the clubs' heads in one room, and one to one.
--
-- Joey, 9 Nov 2026 — the organiser groups, and "Academy vs league organiser"
-- items 2–3:
--   * Each competition gets a "<Competition> Clubs" group chat: the league's
--     staff and the head (owner or admin) of every entered club. No parents,
--     coaches or players. Members follow the entries — added and removed as
--     clubs enter and leave — and nobody is added by hand. Two-way, unlike
--     the read-only Notices (0213).
--   * A league organiser can start a one-to-one chat with any entered
--     club's head, and a club head with the league's staff. Never with
--     another club's parents or coaches, and never one club's head with
--     another's.
--   * Each organiser gets a "<League> Referees" room: its staff and its
--     referees.
--
-- The second exception, at Joey's word, to "being in a competition together
-- lets you see the DRAW, not each other's PEOPLE" (CLAUDE.md): the people in
-- these rooms are the adults who run things, and they see each other by
-- name and club. What 0213 protected is kept: membership is computed from
-- the competition (clubs_standing / referees_standing), never stored as
-- channel_members rows, so a family is never in it and nothing about a
-- family is in it.
--
-- Two-step (0231/0232) applies: a head or a league member proves their
-- standing for THEIR OWN session through the role helpers, so a password-
-- only session at an organisation that requires two-step is in no room.

-- ================================================================= shape

-- A clubs room belongs to a competition; a referees room to an organiser;
-- a competition's direct chat (below) may carry the competition too.
alter table public.channels drop constraint if exists channels_notices_need_a_competition;
alter table public.channels add constraint channels_notices_need_a_competition
  check (
    case
      when type in ('notices', 'clubs') then competition_id is not null
      when type = 'direct' then true
      else competition_id is null
    end
  );

create unique index if not exists channels_one_clubs
  on public.channels (competition_id) where type = 'clubs';
create unique index if not exists channels_one_referees
  on public.channels (academy_id) where type = 'referees';

-- ============================================================ who is in it

-- Where one person stands in a competition's Clubs room:
--   league  the organiser's owners and admins, and anyone holding a league
--           role there
--   head    an owner or admin of a club that has entered (active)
--   null    nobody — a parent, a coach, a club that has not entered
-- For the caller, the role helpers decide (two-step and a lapsed check
-- included); for anyone else, the rows.
create or replace function app_private.clubs_standing(p_competition uuid, p_profile uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
begin
  if p_profile is null then
    return null;
  end if;
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null then
    return null;
  end if;

  if p_profile = auth.uid() then
    if coalesce(app_private.is_academy_staff(v_org), false)
       or coalesce(array_length(app_private.league_roles_of(v_org), 1), 0) > 0 then
      return 'league';
    end if;
    if exists (
      select 1 from public.competition_clubs cc
       where cc.competition_id = p_competition and cc.status = 'active'
         and app_private.academy_role_of(cc.academy_id) in ('owner', 'admin')) then
      return 'head';
    end if;
    return null;
  end if;

  if exists (select 1 from public.academy_members am
              where am.academy_id = v_org and am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin'))
     or exists (select 1 from public.league_roles lr where lr.academy_id = v_org and lr.profile_id = p_profile) then
    return 'league';
  end if;
  if exists (
    select 1 from public.competition_clubs cc
    join public.academy_members am on am.academy_id = cc.academy_id
   where cc.competition_id = p_competition and cc.status = 'active'
     and am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin')) then
    return 'head';
  end if;
  return null;
end;
$fn$;

-- Where one person stands in an organiser's Referees room: league (its
-- owners, admins and league roles) or referee (an active referee of its pool).
create or replace function app_private.referees_standing(p_academy uuid, p_profile uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
begin
  if p_profile is null or p_academy is null then
    return null;
  end if;
  if p_profile = auth.uid() then
    if coalesce(app_private.is_academy_staff(p_academy), false)
       or coalesce(array_length(app_private.league_roles_of(p_academy), 1), 0) > 0 then
      return 'league';
    end if;
  elsif exists (select 1 from public.academy_members am
                 where am.academy_id = p_academy and am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin'))
     or exists (select 1 from public.league_roles lr where lr.academy_id = p_academy and lr.profile_id = p_profile) then
    return 'league';
  end if;
  if exists (select 1 from public.referees r
              where r.academy_id = p_academy and r.profile_id = p_profile and r.status = 'active') then
    return 'referee';
  end if;
  return null;
end;
$fn$;

-- The caller's standing in a computed room, whichever kind it is.
create or replace function app_private.group_standing(p_channel uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select case c.type
    when 'clubs' then app_private.clubs_standing(c.competition_id, auth.uid())
    when 'referees' then app_private.referees_standing(c.academy_id, auth.uid())
  end
  from public.channels c where c.id = p_channel;
$fn$;

-- Everyone in a computed room, with their standing — for pushes and for the
-- room's own people list. Nothing for any other kind of channel.
create or replace function app_private.group_people(p_channel uuid)
returns table (profile_id uuid, standing text)
language sql stable security definer set search_path = public as $fn$
  with ch as (
    select id, type, academy_id, competition_id from public.channels
     where id = p_channel and type in ('clubs', 'referees')
  ),
  everyone as (
    select am.profile_id, 'league'::text as standing, 1 as rank
      from public.academy_members am join ch on am.academy_id = ch.academy_id
     where am.status = 'active' and am.role in ('owner', 'admin')
    union all
    select lr.profile_id, 'league', 1
      from public.league_roles lr join ch on lr.academy_id = ch.academy_id
    union all
    select am.profile_id, 'head', 2
      from ch
      join public.competition_clubs cc on cc.competition_id = ch.competition_id and cc.status = 'active'
      join public.academy_members am on am.academy_id = cc.academy_id
     where ch.type = 'clubs' and am.status = 'active' and am.role in ('owner', 'admin')
    union all
    select r.profile_id, 'referee', 3
      from ch join public.referees r on r.academy_id = ch.academy_id
     where ch.type = 'referees' and r.profile_id is not null and r.status = 'active'
  )
  select distinct on (e.profile_id) e.profile_id, e.standing
    from everyone e
   order by e.profile_id, e.rank;
$fn$;

-- Membership and hosting, with the computed rooms added to 0213's shape.
create or replace function app_private.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel and profile_id = auth.uid()
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type = 'notices'
       and app_private.notices_standing(c.competition_id, auth.uid()) is not null
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type in ('clubs', 'referees')
       and app_private.group_standing(p_channel) is not null
  );
$$;

create or replace function app_private.is_channel_host(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel
       and profile_id = auth.uid()
       and role in ('host', 'co_host')
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel
       and c.type <> 'direct'          -- nobody is a host of someone else's DM
       and app_private.is_academy_staff(c.academy_id)
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type = 'notices'
       and app_private.notices_standing(c.competition_id, auth.uid()) = 'league'
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type in ('clubs', 'referees')
       and app_private.group_standing(p_channel) = 'league'
  );
$$;

-- ======================================================== the rooms exist

create or replace function app_private.ensure_clubs_channel(p_competition uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp public.competitions;
  v_id   uuid;
begin
  select * into v_comp from public.competitions where id = p_competition;
  if v_comp.id is null then
    return null;
  end if;

  select id into v_id from public.channels where type = 'clubs' and competition_id = p_competition;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.channels
    (academy_id, type, competition_id, name, description, posting_mode, status, archived_at, created_by)
  values (
    v_comp.organiser_id, 'clubs', v_comp.id,
    btrim(v_comp.name) || ' Clubs',
    'The league and the head of every club in ' || btrim(v_comp.name) || '. Two-way; who is in it follows the entries.',
    'open',
    case when v_comp.status = 'ended' then 'archived'::public.channel_status else 'active' end,
    case when v_comp.status = 'ended' then now() end,
    v_comp.created_by
  )
  on conflict (competition_id) where type = 'clubs' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.channels where type = 'clubs' and competition_id = p_competition;
  end if;
  return v_id;
end;
$$;

create or replace function app_private.on_competition_clubs_chat()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.ensure_clubs_channel(new.id);
  elsif new.name is distinct from old.name or new.status is distinct from old.status then
    update public.channels
       set name = btrim(new.name) || ' Clubs',
           status = case when new.status = 'ended' then 'archived'::public.channel_status else 'active' end,
           archived_at = case when new.status = 'ended' then coalesce(archived_at, now()) end
     where type = 'clubs' and competition_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists competitions_clubs_chat on public.competitions;
create trigger competitions_clubs_chat
  after insert or update of name, status on public.competitions
  for each row execute function app_private.on_competition_clubs_chat();

create or replace function app_private.ensure_referees_channel(p_academy uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org public.academies;
  v_id  uuid;
begin
  select * into v_org from public.academies where id = p_academy;
  if v_org.id is null then
    return null;
  end if;

  select id into v_id from public.channels where type = 'referees' and academy_id = p_academy;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.channels (academy_id, type, name, description, posting_mode, status, created_by)
  values (
    v_org.id, 'referees',
    btrim(v_org.name) || ' Referees',
    'The league and its referees. Two-way; every referee in the pool is in it.',
    'open', 'active', null
  )
  on conflict (academy_id) where type = 'referees' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.channels where type = 'referees' and academy_id = p_academy;
  end if;
  return v_id;
end;
$$;

-- A league has a Referees room from the day it is made; any other
-- organisation gets one the day it has a referee. A rename follows.
create or replace function app_private.on_academy_referees_chat()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.type = 'league' then
      perform app_private.ensure_referees_channel(new.id);
    end if;
  else
    if new.type = 'league' and old.type is distinct from 'league' then
      perform app_private.ensure_referees_channel(new.id);
    end if;
    if new.name is distinct from old.name then
      update public.channels set name = btrim(new.name) || ' Referees'
       where type = 'referees' and academy_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists academies_referees_chat on public.academies;
create trigger academies_referees_chat
  after insert or update of name, type on public.academies
  for each row execute function app_private.on_academy_referees_chat();

create or replace function app_private.on_referee_added()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app_private.ensure_referees_channel(new.academy_id);
  return new;
end;
$$;

drop trigger if exists referees_room on public.referees;
create trigger referees_room
  after insert on public.referees
  for each row execute function app_private.on_referee_added();

-- Every competition that exists gets its Clubs room now; every league, and
-- every organisation with a referee, its Referees room.
select app_private.ensure_clubs_channel(c.id) from public.competitions c;
select app_private.ensure_referees_channel(a.id) from public.academies a
 where a.type = 'league' or exists (select 1 from public.referees r where r.academy_id = a.id);

-- ================================================================ guards

-- Nobody is added to a computed room by hand (0213's trigger, widened).
create or replace function app_private.refuse_notices_members()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.channels c where c.id = new.channel_id and c.type in ('notices', 'clubs', 'referees')) then
    raise exception 'nobody is added to this channel by hand: who is in it follows the competition'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A computed room keeps its kind, its competition and its organiser; the
-- Notices also keep "only the league posts".
create or replace function app_private.guard_notices_channel()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.type in ('notices', 'clubs', 'referees') or new.type in ('notices', 'clubs', 'referees') then
    if new.type is distinct from old.type
       or new.competition_id is distinct from old.competition_id
       or new.academy_id is distinct from old.academy_id then
      raise exception 'a competition''s channels stay the league''s' using errcode = '42501';
    end if;
    if new.type = 'notices' and new.posting_mode is distinct from 'hosts_only' then
      raise exception 'only the league posts in a competition''s Notices' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Computed rooms are made by the competition, never by a client, and never deleted.
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)) and type not in ('notices', 'clubs', 'referees'));

drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated
  using (type not in ('direct', 'notices', 'clubs', 'referees') and (select app_private.is_academy_staff(academy_id)));

-- ============================================================ the chat list

-- The computed rooms I am in, with my standing in each.
create or replace function app_private.my_groups()
returns table (channel_id uuid, standing text)
language sql stable security definer set search_path = public as $fn$
  with heads as (
    select am.academy_id from public.academy_members am
     where am.profile_id = auth.uid() and am.status = 'active' and am.role in ('owner', 'admin')
  ),
  league_at as (
    select academy_id from heads
    union
    select lr.academy_id from public.league_roles lr where lr.profile_id = auth.uid()
  ),
  candidates as (
    select ch.id from public.channels ch
     where ch.type = 'clubs'
       and (ch.academy_id in (select academy_id from league_at)
            or ch.competition_id in (select cc.competition_id from public.competition_clubs cc
                                      where cc.status = 'active' and cc.academy_id in (select academy_id from heads)))
    union
    select ch.id from public.channels ch
     where ch.type = 'referees'
       and (ch.academy_id in (select academy_id from league_at)
            or ch.academy_id in (select r.academy_id from public.referees r
                                  where r.profile_id = auth.uid() and r.status = 'active'))
  )
  select k.id, s.standing
    from candidates k
    cross join lateral (select app_private.group_standing(k.id) as standing) s
   where s.standing is not null;
$fn$;

-- my_channels (0213), with a third branch for the computed rooms, and the
-- first branch also listing a competition's direct chats for the club's
-- side (they live under the organiser, so "my club" would not find them).
create or replace function public.my_channels(p_academy uuid)
returns table (
  channel_id     uuid,
  name           text,
  type           public.channel_type,
  team_id        uuid,
  posting_mode   public.posting_mode,
  status         public.channel_status,
  my_role        public.channel_member_role,
  muted          boolean,
  unread_count   integer,
  last_message_at   timestamptz,
  last_message_body text,
  last_sender_name  text
)
language sql stable security definer set search_path = public as $fn$
  select x.* from (
    select
      c.id,
      coalesce(c.name, dm.full_name, 'Direct message'),
      c.type, c.team_id, c.posting_mode, c.status,
      cm.role, cm.muted,
      (
        select count(*)::integer
          from public.messages m
         where m.channel_id = c.id
           and m.created_at > cm.last_read_at
           and m.sender_id is distinct from auth.uid()
           and m.deleted_at is null
           and m.status = 'published'
      ),
      last.created_at,
      case
        when last.id is null then null
        when last.deleted_at is not null then 'Message deleted'
        when nullif(btrim(coalesce(last.body, '')), '') is not null then last.body
        when last.event_id is not null then
          '📅 ' || coalesce((select e.title from public.events e where e.id = last.event_id), 'Fixture')
        when exists (select 1 from public.polls p where p.message_id = last.id) then
          '📊 ' || coalesce((select p.question from public.polls p where p.message_id = last.id), 'Poll')
        when jsonb_array_length(coalesce(last.attachments, '[]'::jsonb)) > 0 then
          app_private.attachment_icon(last.attachments) || ' ' || app_private.attachment_label(last.attachments)
        else null
      end,
      (select p.full_name from public.profiles p where p.id = last.sender_id)
    from public.channels c
    join public.channel_members cm
      on cm.channel_id = c.id and cm.profile_id = auth.uid()
    left join lateral (
      select m.id, m.body, m.created_at, m.sender_id, m.event_id, m.attachments, m.deleted_at
        from public.messages m
       where m.channel_id = c.id and m.status = 'published'
       order by m.created_at desc
       limit 1
    ) last on true
    left join lateral (
      select pr.full_name
        from public.channel_members other
        join public.profiles pr on pr.id = other.profile_id
       where c.type = 'direct'
         and other.channel_id = c.id
         and other.profile_id <> auth.uid()
       limit 1
    ) dm on true
   where c.academy_id = p_academy
      or (c.type = 'direct' and c.competition_id is not null
          and exists (select 1 from public.competition_clubs cc
                       where cc.competition_id = c.competition_id and cc.academy_id = p_academy and cc.status = 'active'))

    union all

    select
      ch.id, ch.name, ch.type, ch.team_id, ch.posting_mode, ch.status,
      (case when n.standing = 'league' then 'host' else 'member' end)::public.channel_member_role,
      false,
      (
        select count(*)::integer
          from public.messages m
         where m.channel_id = ch.id
           and m.created_at > coalesce(nr.last_read_at, '-infinity'::timestamptz)
           and m.sender_id is distinct from auth.uid()
           and m.deleted_at is null
           and m.status = 'published'
           and (m.audience = 'everyone' or n.standing in ('league', 'staff'))
      ),
      last.created_at,
      case
        when last.id is null then null
        when last.deleted_at is not null then 'Message deleted'
        when nullif(btrim(coalesce(last.body, '')), '') is not null then last.body
        when jsonb_array_length(coalesce(last.attachments, '[]'::jsonb)) > 0 then
          app_private.attachment_icon(last.attachments) || ' ' || app_private.attachment_label(last.attachments)
        else null
      end,
      (select p.full_name from public.profiles p where p.id = last.sender_id)
    from app_private.my_notices() n
    join public.channels ch on ch.id = n.channel_id
    left join public.notice_reads nr on nr.channel_id = ch.id and nr.profile_id = auth.uid()
    left join lateral (
      select m.id, m.body, m.created_at, m.sender_id, m.attachments, m.deleted_at
        from public.messages m
       where m.channel_id = ch.id and m.status = 'published'
         and (m.audience = 'everyone' or n.standing in ('league', 'staff'))
       order by m.created_at desc
       limit 1
    ) last on true

    union all

    select
      ch.id, ch.name, ch.type, ch.team_id, ch.posting_mode, ch.status,
      (case when g.standing = 'league' then 'host' else 'member' end)::public.channel_member_role,
      false,
      (
        select count(*)::integer
          from public.messages m
         where m.channel_id = ch.id
           and m.created_at > coalesce(nr.last_read_at, '-infinity'::timestamptz)
           and m.sender_id is distinct from auth.uid()
           and m.deleted_at is null
           and m.status = 'published'
      ),
      last.created_at,
      case
        when last.id is null then null
        when last.deleted_at is not null then 'Message deleted'
        when nullif(btrim(coalesce(last.body, '')), '') is not null then last.body
        when last.event_id is not null then
          '📅 ' || coalesce((select e.title from public.events e where e.id = last.event_id), 'Fixture')
        when exists (select 1 from public.polls p where p.message_id = last.id) then
          '📊 ' || coalesce((select p.question from public.polls p where p.message_id = last.id), 'Poll')
        when jsonb_array_length(coalesce(last.attachments, '[]'::jsonb)) > 0 then
          app_private.attachment_icon(last.attachments) || ' ' || app_private.attachment_label(last.attachments)
        else null
      end,
      (select p.full_name from public.profiles p where p.id = last.sender_id)
    from app_private.my_groups() g
    join public.channels ch on ch.id = g.channel_id
    left join public.notice_reads nr on nr.channel_id = ch.id and nr.profile_id = auth.uid()
    left join lateral (
      select m.id, m.body, m.created_at, m.sender_id, m.event_id, m.attachments, m.deleted_at
        from public.messages m
       where m.channel_id = ch.id and m.status = 'published'
       order by m.created_at desc
       limit 1
    ) last on true
  ) x (channel_id, name, type, team_id, posting_mode, status, my_role, muted,
       unread_count, last_message_at, last_message_body, last_sender_name)
  order by (x.status = 'archived'), x.last_message_at desc nulls last, x.name;
$fn$;

-- Read state for a computed room lives in notice_reads, as for the Notices.
create or replace function public.mark_channel_read(p_channel uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.channels c where c.id = p_channel and c.type in ('notices', 'clubs', 'referees')) then
    if app_private.is_channel_member(p_channel) then
      insert into public.notice_reads (channel_id, profile_id, last_read_at)
      values (p_channel, auth.uid(), now())
      on conflict (channel_id, profile_id) do update
        set last_read_at = excluded.last_read_at
        where public.notice_reads.last_read_at < excluded.last_read_at;
    end if;
    return;
  end if;

  update public.channel_members
     set last_read_at = now()
   where channel_id = p_channel
     and profile_id = auth.uid()
     and last_read_at < now();
end;
$$;

-- ================================================================= pushes

-- Who a message in a channel reaches: its member rows, or, for a computed
-- room, its computed people (who cannot mute it — there is no row to mute).
create or replace function app_private.channel_recipients(p_channel uuid)
returns table (profile_id uuid, muted boolean)
language sql stable security definer set search_path = public as $fn$
  select cm.profile_id, cm.muted from public.channel_members cm where cm.channel_id = p_channel
  union all
  select gp.profile_id, false from app_private.group_people(p_channel) gp;
$fn$;

create or replace function public.enqueue_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_channel public.channels%rowtype;
  v_sender  text;
  v_title   text;
  v_body    text;
  v_everyone boolean := false;
  v_thread  boolean := false;
begin
  if new.status <> 'published' or new.deleted_at is not null then
    return new;
  end if;

  select * into v_channel from public.channels where id = new.channel_id;
  select full_name into v_sender from public.profiles where id = new.sender_id;

  if v_channel.type = 'notices' then
    insert into public.notification_queue
      (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
    select
      new.academy_id, np.profile_id, 'announcement',
      coalesce(v_channel.name, 'Notices'),
      case
        when new.body is not null and length(btrim(new.body)) > 0 then left(new.body, 140)
        else 'A new notice: ' || lower(coalesce(app_private.attachment_label(new.attachments), 'attachment'))
      end,
      '/chat/' || new.channel_id,
      jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id, 'count', 1),
      now(),
      new.id::text || ':' || np.profile_id::text
    from app_private.notices_people(v_channel.competition_id) np
    join public.user_settings us on us.profile_id = np.profile_id
    where np.profile_id <> new.sender_id
      and (new.audience = 'everyone' or np.standing in ('league', 'staff'))
      and us.notify_announcements
    on conflict (dedupe_key) do nothing;
    return new;
  end if;

  if new.mention_everyone and exists (
    select 1 from public.channel_members cm where cm.channel_id = new.channel_id and cm.profile_id = new.sender_id and cm.role = 'host'
  ) then
    v_everyone := true;
  end if;

  if new.reply_to_id is not null and exists (select 1 from public.messages a where a.id = new.reply_to_id and a.is_announcement) then
    v_thread := true;
  end if;

  v_title := case
    when v_channel.type = 'direct' then coalesce(v_sender, 'New message')
    when new.is_announcement then coalesce(v_channel.name, 'Announcement')
    when v_thread then 'Reply in ' || coalesce(v_channel.name, 'the channel')
    else coalesce(v_channel.name, 'New message')
  end;

  v_body := case
    when new.body is not null and length(btrim(new.body)) > 0
      then case when v_channel.type = 'direct' then '' else coalesce(v_sender || ': ', '') end
           || left(new.body, 140)
    when new.event_id is not null then coalesce(v_sender || ' shared a fixture', 'A fixture was shared')
    when new.poll_id  is not null then coalesce(v_sender || ' asked a question', 'A poll was posted')
    else coalesce(v_sender, 'Somebody') || ' sent a ' || lower(coalesce(app_private.attachment_label(new.attachments), 'photo'))
  end;

  insert into public.notification_queue
    (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select
    new.academy_id, cm.profile_id,
    case
      when cm.profile_id = any (new.mentions) or v_everyone then 'mention'
      when new.is_announcement then 'announcement'
      else 'message'
    end,
    case when cm.profile_id = any (new.mentions) or v_everyone
         then coalesce(v_sender, 'Somebody') || ' mentioned you' || case when v_channel.type = 'direct' then '' else ' in ' || coalesce(v_channel.name, 'a channel') end
         else v_title end,
    v_body,
    '/chat/' || new.channel_id,
    jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id, 'count', 1),
    greatest(
      case
        when new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone or v_channel.type = 'direct' or us.digest_minutes = 0 then now()
        else to_timestamp((floor(extract(epoch from now()) / (us.digest_minutes * 60)) + 1) * us.digest_minutes * 60)
      end,
      case
        when not (new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone)
         and us.quiet_hours_enabled
         and (public.zone_time(a.timezone) >= us.quiet_hours_start
              or public.zone_time(a.timezone) < us.quiet_hours_end)
        then ((current_date + 1) + us.quiet_hours_end) at time zone a.timezone
        else now()
      end
    ),
    case
      when new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone or v_channel.type = 'direct' or us.digest_minutes = 0
        then new.id::text || ':' || cm.profile_id::text
      else 'digest:' || new.channel_id::text || ':' || cm.profile_id::text || ':' || floor(extract(epoch from now()) / (us.digest_minutes * 60))::text
    end
  from app_private.channel_recipients(new.channel_id) cm
  join public.user_settings us on us.profile_id = cm.profile_id
  join public.academies a on a.id = new.academy_id
  where cm.profile_id <> new.sender_id
    and (not cm.muted or new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone)
    and (cm.profile_id = any (new.mentions) or v_everyone
         or (case when new.is_announcement then us.notify_announcements else us.notify_messages end))
    and (not v_thread
         or cm.profile_id = any (new.mentions) or v_everyone
         or cm.profile_id in (
              select x.sender_id from public.messages x where x.id = new.reply_to_id
              union
              select x.sender_id from public.messages x where x.reply_to_id = new.reply_to_id and x.status = 'published' and x.deleted_at is null))
  on conflict (dedupe_key) do update
    set payload = public.notification_queue.payload || jsonb_build_object('count', coalesce((public.notification_queue.payload->>'count')::integer, 1) + 1, 'message_id', excluded.payload->>'message_id'),
        body = (coalesce((public.notification_queue.payload->>'count')::integer, 1) + 1) || ' new messages in ' || coalesce(v_channel.name, 'the channel'),
        title = coalesce(v_channel.name, 'New messages')
    where public.notification_queue.sent_at is null
      and public.notification_queue.dedupe_key like 'digest:%';

  return new;
end;
$$;

-- ============================================================ one to one

-- A league organiser with an entered club's head, or a club's head with the
-- league — never a parent or coach, never one club's head with another's.
-- The chat lives under the organiser and carries the competition, so the
-- club's side finds it in their own list (my_channels, branch one).
create or replace function public.open_competition_direct(p_competition uuid, p_other uuid)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me     uuid := auth.uid();
  v_org    uuid;
  v_mine   text;
  v_theirs text;
  v_key    text;
  v_id     uuid;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'you cannot message yourself' using errcode = '22023';
  end if;
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null then
    raise exception 'no such competition' using errcode = '42501';
  end if;

  v_mine := app_private.clubs_standing(p_competition, v_me);
  v_theirs := app_private.clubs_standing(p_competition, p_other);
  if v_mine is null or v_theirs is null or (v_mine <> 'league' and v_theirs <> 'league') then
    raise exception 'in a competition the league messages a club''s head, and a club''s head the league — nobody else'
      using errcode = '42501';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  select id into v_id from public.channels
   where academy_id = v_org and type = 'direct' and dm_key = v_key;

  if v_id is null then
    insert into public.channels (academy_id, type, dm_key, name, competition_id, created_by)
    values (v_org, 'direct', v_key, null, p_competition, v_me)
    returning id into v_id;

    insert into public.channel_members (academy_id, channel_id, profile_id, role)
    values (v_org, v_id, v_me, 'member'), (v_org, v_id, p_other, 'member');
  else
    -- A chat the two already had under the league (open_direct_channel)
    -- now carries the competition, so the club's side finds it too.
    update public.channels set competition_id = p_competition
     where id = v_id and competition_id is null;
  end if;

  return v_id;
end;
$fn$;

-- The people the caller may message in a competition, and its Clubs room
-- (competition_contacts is 0048's older list for the broadcast tab):
--   a league member sees every entered club's heads (name, role, club);
--   a club's head sees the league's staff (name, role, league);
--   anyone else gets {"standing": null}. Names and roles — never a number.
create or replace function public.competition_people(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_standing text;
  v_org      uuid;
  v_room     uuid;
  v_people   jsonb;
begin
  if v_me is null then
    return jsonb_build_object('standing', null);
  end if;
  v_standing := app_private.clubs_standing(p_competition, v_me);
  if v_standing is null then
    return jsonb_build_object('standing', null);
  end if;
  select organiser_id into v_org from public.competitions where id = p_competition;
  select id into v_room from public.channels where type = 'clubs' and competition_id = p_competition;

  if v_standing = 'league' then
    select coalesce(jsonb_agg(jsonb_build_object('profile_id', x.profile_id, 'name', x.name, 'role', x.role, 'club', x.club) order by x.club, x.name), '[]'::jsonb)
      into v_people
      from (
        select distinct on (am.profile_id, cc.academy_id)
               am.profile_id, p.full_name as name, initcap(am.role::text) as role, a.name as club
          from public.competition_clubs cc
          join public.academy_members am on am.academy_id = cc.academy_id
          join public.profiles p on p.id = am.profile_id
          join public.academies a on a.id = cc.academy_id
         where cc.competition_id = p_competition and cc.status = 'active'
           and cc.academy_id <> v_org
           and am.status = 'active' and am.role in ('owner', 'admin')
           and am.profile_id <> v_me
      ) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('profile_id', x.profile_id, 'name', x.name, 'role', x.role, 'club', x.club) order by x.rank, x.name), '[]'::jsonb)
      into v_people
      from (
        select distinct on (y.profile_id) y.profile_id, y.name, y.role, y.club, y.rank
          from (
            select am.profile_id, p.full_name as name, initcap(am.role::text) as role, a.name as club, 1 as rank
              from public.academy_members am
              join public.profiles p on p.id = am.profile_id
              join public.academies a on a.id = am.academy_id
             where am.academy_id = v_org and am.status = 'active' and am.role in ('owner', 'admin')
            union all
            select lr.profile_id, p.full_name, replace(initcap(lr.role::text), '_', ' '), a.name, 2
              from public.league_roles lr
              join public.profiles p on p.id = lr.profile_id
              join public.academies a on a.id = lr.academy_id
             where lr.academy_id = v_org
          ) y
         where y.profile_id <> v_me
         order by y.profile_id, y.rank
      ) x;
  end if;

  return jsonb_build_object(
    'standing', v_standing,
    'clubs_channel_id', v_room,
    'league', (select name from public.academies where id = v_org),
    'competition', (select name from public.competitions where id = p_competition),
    'people', v_people);
end;
$fn$;

-- What the chat screen needs for a computed room: its kind, the caller's
-- standing (host = the league), the league's and competition's names, and
-- who is in it — name, standing and club. Null for anyone not in it.
create or replace function public.group_channel_info(p_channel uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  c          public.channels%rowtype;
  v_standing text;
  v_people   jsonb;
begin
  if v_me is null then
    return null;
  end if;
  select * into c from public.channels where id = p_channel and type in ('clubs', 'referees');
  if c.id is null then
    return null;
  end if;
  v_standing := app_private.group_standing(p_channel);
  if v_standing is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', z.profile_id, 'name', z.name, 'standing', z.standing, 'club', z.club)
                            order by (z.standing <> 'league'), z.club nulls first, z.name), '[]'::jsonb)
    into v_people
    from (
      select gp.profile_id, p.full_name as name, gp.standing,
             case
               when gp.standing = 'league' then (select a.name from public.academies a where a.id = c.academy_id)
               when gp.standing = 'head' then (
                 select a.name from public.competition_clubs cc
                   join public.academy_members am on am.academy_id = cc.academy_id
                   join public.academies a on a.id = cc.academy_id
                  where cc.competition_id = c.competition_id and cc.status = 'active'
                    and am.profile_id = gp.profile_id and am.status = 'active' and am.role in ('owner', 'admin')
                  order by a.name limit 1)
               else null
             end as club
        from app_private.group_people(p_channel) gp
        join public.profiles p on p.id = gp.profile_id
    ) z;

  return jsonb_build_object(
    'kind', c.type,
    'standing', v_standing,
    'is_host', v_standing = 'league',
    'league', (select a.name from public.academies a where a.id = c.academy_id),
    'competition', (select k.name from public.competitions k where k.id = c.competition_id),
    'people', v_people);
end;
$fn$;

-- ================================================================= grants

revoke execute on function app_private.clubs_standing(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.referees_standing(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.group_standing(uuid) from public, anon, authenticated;
revoke execute on function app_private.group_people(uuid) from public, anon, authenticated;
revoke execute on function app_private.ensure_clubs_channel(uuid) from public, anon, authenticated;
revoke execute on function app_private.ensure_referees_channel(uuid) from public, anon, authenticated;
revoke execute on function app_private.on_competition_clubs_chat() from public, anon, authenticated;
revoke execute on function app_private.on_academy_referees_chat() from public, anon, authenticated;
revoke execute on function app_private.on_referee_added() from public, anon, authenticated;
revoke execute on function app_private.my_groups() from public, anon, authenticated;
revoke execute on function app_private.channel_recipients(uuid) from public, anon, authenticated;

revoke execute on function public.open_competition_direct(uuid, uuid) from public, anon;
grant execute on function public.open_competition_direct(uuid, uuid) to authenticated;
revoke execute on function public.competition_people(uuid) from public, anon;
grant execute on function public.competition_people(uuid) to authenticated;
revoke execute on function public.group_channel_info(uuid) from public, anon;
grant execute on function public.group_channel_info(uuid) to authenticated;

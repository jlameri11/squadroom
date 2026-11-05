-- 0213: the league speaks to everyone in it (Joey, 5 Nov 2026; extends L-11).
--
-- Each competition gets a read-only "Notices" channel ("SPL Season 3
-- Notices"). Everyone in the competition is in it automatically: the
-- league's own people, the entered clubs' staff, the families (and any
-- players with a login) of the entered teams, and the league's referees.
-- Only league staff post. Each notice goes to Everyone, or to Club staff
-- only. Delivered in the app and by push; the league sees how many have seen
-- it; attachments as in chat.
--
-- THIS REVERSES A RECORDED DECISION, at Joey's word. Until now a league never
-- addressed families: 0048 mirrored an announcement into each club's own
-- channel rather than build "a channel spanning every club", and 0157
-- narrowed even that to each club's coaches ("the families of forty squads
-- are not the league's to address"). CLAUDE.md said no policy on messages,
-- members or channels would ever mention competitions. Joey's brief of 5 Nov
-- asks for exactly that channel, so it is built — and what those decisions
-- were protecting is kept:
--
--   · NOBODY IN IT CAN SEE ANYBODY ELSE IN IT. Membership is worked out from
--     the competition (notices_standing), never stored as channel_members
--     rows, so there is no member list to read, nobody to mention, no "seen
--     by" names — the league gets counts — and nobody's name goes out as
--     "typing". Reactions are refused (who reacted is a list of names).
--   · It is one-way. No replies, no polls, no reactions; only the league
--     posts, and the channel cannot be opened up by changing its settings.
--   · "Club staff only" means it: the message, its push and its files are
--     invisible to families, by policy, not by the app hiding them.
--
-- Read state lives in notice_reads (who has opened the channel, when), the
-- only per-person row this keeps.
--
-- Unapplied until the Supabase access token is renewed (NEEDS JOEY #12);
-- test-rls checks 115–123.

-- ===================================================================== shape

alter table public.channels
  add column if not exists competition_id uuid references public.competitions(id) on delete cascade;

create unique index if not exists channels_one_notices
  on public.channels (competition_id) where type = 'notices';

alter table public.channels drop constraint if exists channels_notices_need_a_competition;
alter table public.channels add constraint channels_notices_need_a_competition
  check ((type = 'notices') = (competition_id is not null));

-- Who a message is for. Everything is for everyone, bar a competition's
-- notices sent to club staff only.
alter table public.messages
  add column if not exists audience text not null default 'everyone';
alter table public.messages drop constraint if exists messages_audience_known;
alter table public.messages add constraint messages_audience_known
  check (audience in ('everyone', 'club_staff'));

-- The organisation's contact address: a league's notices are emailed with
-- it as the reply-to (the email half needs RESEND_API_KEY; NEEDS JOEY #19).
alter table public.academies
  add column if not exists contact_email citext;
alter table public.academies drop constraint if exists academies_contact_email_shape;
alter table public.academies add constraint academies_contact_email_shape
  check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Who has opened a competition's Notices, and when. Nothing else about them.
create table if not exists public.notice_reads (
  channel_id   uuid not null references public.channels(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, profile_id)
);
alter table public.notice_reads enable row level security;
drop policy if exists notice_reads_own on public.notice_reads;
create policy notice_reads_own on public.notice_reads for select to authenticated
  using (profile_id = (select auth.uid()));
-- Written only by mark_channel_read.

-- ============================================================ who is in it

-- Where one person stands in one competition:
--   league   the organiser's owners and admins, and its competition managers
--            — they post;
--   staff    the league's other officers, and each entered club's owners,
--            admins and coaches (L-11 reached every coach of an entered
--            club; it still does);
--   family   the parents (and players with a login) of an entered team;
--   referee  the organiser's active referees;
--   null     not in it.
-- An entered club is an active competition_clubs row; the organiser's own
-- entered teams count too (a club running its own gala day).
create or replace function app_private.notices_standing(p_competition uuid, p_profile uuid)
returns text
language sql stable security definer set search_path = public as $$
  with c as (
    select id, organiser_id from public.competitions where id = p_competition
  ),
  clubs as (
    select cc.academy_id from public.competition_clubs cc
     where cc.competition_id = p_competition and cc.status = 'active'
    union
    select organiser_id from c
  ),
  teams as (
    select ce.team_id from public.competition_entries ce
     where ce.competition_id = p_competition
       and ce.team_id is not null
       and ce.academy_id in (select academy_id from clubs)
  )
  select case
    when p_profile is null or not exists (select 1 from c) then null
    when exists (select 1 from public.academy_members am join c on am.academy_id = c.organiser_id
                  where am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin'))
      or exists (select 1 from public.league_roles lr join c on lr.academy_id = c.organiser_id
                  where lr.profile_id = p_profile and lr.role = 'competition_manager')
      then 'league'
    when exists (select 1 from public.league_roles lr join c on lr.academy_id = c.organiser_id
                  where lr.profile_id = p_profile)
      or exists (select 1 from public.academy_members am
                  where am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin', 'coach')
                    and am.academy_id in (select academy_id from clubs))
      or exists (select 1 from public.team_members tm
                  where tm.profile_id = p_profile and tm.role = 'coach'
                    and tm.team_id in (select team_id from teams))
      then 'staff'
    when exists (select 1 from public.team_members tm
                  where tm.profile_id = p_profile and tm.role in ('parent', 'player')
                    and tm.team_id in (select team_id from teams))
      then 'family'
    when exists (select 1 from public.referees r join c on r.academy_id = c.organiser_id
                  where r.profile_id = p_profile and r.status = 'active')
      then 'referee'
  end;
$$;

-- Everyone at once, for a push and for "seen by": the same rules as
-- notices_standing (test-rls 121 holds the two together).
create or replace function app_private.notices_people(p_competition uuid)
returns table (profile_id uuid, standing text)
language sql stable security definer set search_path = public as $$
  with c as (
    select id, organiser_id from public.competitions where id = p_competition
  ),
  clubs as (
    select cc.academy_id from public.competition_clubs cc
     where cc.competition_id = p_competition and cc.status = 'active'
    union
    select organiser_id from c
  ),
  teams as (
    select ce.team_id from public.competition_entries ce
     where ce.competition_id = p_competition
       and ce.team_id is not null
       and ce.academy_id in (select academy_id from clubs)
  ),
  everyone as (
    select am.profile_id, 'league'::text as standing, 1 as rank
      from public.academy_members am join c on am.academy_id = c.organiser_id
     where am.status = 'active' and am.role in ('owner', 'admin')
    union all
    select lr.profile_id,
           case when lr.role = 'competition_manager' then 'league' else 'staff' end,
           case when lr.role = 'competition_manager' then 1 else 2 end
      from public.league_roles lr join c on lr.academy_id = c.organiser_id
    union all
    select am.profile_id, 'staff', 2
      from public.academy_members am
     where am.status = 'active' and am.role in ('owner', 'admin', 'coach')
       and am.academy_id in (select academy_id from clubs)
    union all
    select tm.profile_id, 'staff', 2
      from public.team_members tm
     where tm.role = 'coach' and tm.team_id in (select team_id from teams)
    union all
    select tm.profile_id, 'family', 3
      from public.team_members tm
     where tm.role in ('parent', 'player') and tm.team_id in (select team_id from teams)
    union all
    select r.profile_id, 'referee', 4
      from public.referees r join c on r.academy_id = c.organiser_id
     where r.profile_id is not null and r.status = 'active'
  )
  select distinct on (e.profile_id) e.profile_id, e.standing
    from everyone e
   order by e.profile_id, e.rank;
$$;

create or replace function app_private.is_notices_channel(p_channel uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.channels c where c.id = p_channel and c.type = 'notices');
$$;

-- May the caller read a notice sent to club staff only?
create or replace function app_private.sees_staff_notices(p_channel uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select app_private.notices_standing(c.competition_id, auth.uid()) in ('league', 'staff')
      from public.channels c
     where c.id = p_channel and c.type = 'notices'
  ), false);
$$;

-- The caller's competitions' Notices. Candidates first — competitions run by
-- an organisation they belong to or referee for, or that one of their
-- organisations is entered in — so the exact test runs on a handful, not on
-- every competition in the country.
create or replace function app_private.my_notices()
returns table (channel_id uuid, competition_id uuid, standing text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select am.academy_id from public.academy_members am
     where am.profile_id = auth.uid() and am.status = 'active'
  ),
  candidates as (
    select c.id from public.competitions c
     where c.organiser_id in (select academy_id from mine)
        or c.organiser_id in (select lr.academy_id from public.league_roles lr where lr.profile_id = auth.uid())
        or c.organiser_id in (select r.academy_id from public.referees r
                               where r.profile_id = auth.uid() and r.status = 'active')
    union
    select cc.competition_id from public.competition_clubs cc
     where cc.status = 'active' and cc.academy_id in (select academy_id from mine)
  )
  select ch.id, ch.competition_id, s.standing
    from candidates k
    join public.channels ch on ch.type = 'notices' and ch.competition_id = k.id
    cross join lateral (select app_private.notices_standing(k.id, auth.uid()) as standing) s
   where s.standing is not null;
$$;

-- ========================================================= membership, host

-- A competition's Notices are joined by being in the competition — a row in
-- channel_members never makes anyone a member of them (none may exist).
create or replace function app_private.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel and profile_id = auth.uid()
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel and c.type = 'notices'
       and app_private.notices_standing(c.competition_id, auth.uid()) is not null
  );
$$;

-- And the league hosts them: the organiser's owners and admins already are
-- (they are staff of the channel's organisation); a competition manager is
-- too.
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
  );
$$;

-- ============================================================ the channel

create or replace function app_private.ensure_notices_channel(p_competition uuid)
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

  select id into v_id from public.channels where type = 'notices' and competition_id = p_competition;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.channels
    (academy_id, type, competition_id, name, description, posting_mode, status, archived_at, created_by)
  values (
    v_comp.organiser_id, 'notices', v_comp.id,
    btrim(v_comp.name) || ' Notices',
    'From the league to everyone in ' || btrim(v_comp.name) || '. Only the league posts here.',
    'hosts_only',
    case when v_comp.status = 'ended' then 'archived'::public.channel_status else 'active' end,
    case when v_comp.status = 'ended' then now() end,
    v_comp.created_by
  )
  on conflict (competition_id) where type = 'notices' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.channels where type = 'notices' and competition_id = p_competition;
  end if;
  return v_id;
end;
$$;

create or replace function app_private.on_competition_notices()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.ensure_notices_channel(new.id);
  elsif new.name is distinct from old.name or new.status is distinct from old.status then
    update public.channels
       set name = btrim(new.name) || ' Notices',
           status = case when new.status = 'ended' then 'archived'::public.channel_status else 'active' end,
           archived_at = case when new.status = 'ended' then coalesce(archived_at, now()) end
     where type = 'notices' and competition_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists competitions_notices on public.competitions;
create trigger competitions_notices
  after insert or update of name, status on public.competitions
  for each row execute function app_private.on_competition_notices();

-- Every competition that already exists gets its Notices now.
select app_private.ensure_notices_channel(c.id) from public.competitions c;

-- ================================================================ guards

-- Nobody is added to Notices by hand, by a host, or by any helper: a row
-- would make them a member whether or not they are in the competition.
create or replace function app_private.refuse_notices_members()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.channels c where c.id = new.channel_id and c.type = 'notices') then
    raise exception 'nobody is added to a competition''s Notices: everyone in the competition is in them already'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_members_not_in_notices on public.channel_members;
create trigger channel_members_not_in_notices
  before insert or update of channel_id on public.channel_members
  for each row execute function app_private.refuse_notices_members();

-- The league may rename its Notices or archive them; it may not hand them to
-- another organisation, turn them into something else, or let anyone post.
create or replace function app_private.guard_notices_channel()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.type = 'notices' or new.type = 'notices' then
    if new.type is distinct from old.type
       or new.competition_id is distinct from old.competition_id
       or new.academy_id is distinct from old.academy_id
       or new.posting_mode is distinct from 'hosts_only' then
      raise exception 'a competition''s Notices stay the league''s, and only the league posts in them'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists channels_guard_notices on public.channels;
create trigger channels_guard_notices
  before update on public.channels
  for each row execute function app_private.guard_notices_channel();

-- A notice is an announcement, takes no replies, polls or mentions, and
-- keeps the audience it was sent to. Anything else is for everyone.
create or replace function app_private.guard_notice_message()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_notices boolean;
begin
  select c.type = 'notices' into v_notices from public.channels c where c.id = new.channel_id;

  if coalesce(v_notices, false) then
    if tg_op = 'INSERT' then
      if new.reply_to_id is not null then
        raise exception 'notices take no replies' using errcode = '22023';
      end if;
      if new.poll_id is not null then
        raise exception 'notices take no polls' using errcode = '22023';
      end if;
      new.is_announcement := true;
      new.mentions := '{}';
      new.mention_everyone := false;
    elsif new.audience is distinct from old.audience then
      raise exception 'who a notice went to cannot change after it is sent' using errcode = '22023';
    end if;
  elsif new.audience <> 'everyone' then
    raise exception 'only a competition''s notices go to club staff only' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_guard_notice on public.messages;
create trigger messages_guard_notice
  before insert or update of audience, channel_id on public.messages
  for each row execute function app_private.guard_notice_message();

revoke execute on function app_private.on_competition_notices() from public, anon, authenticated;
revoke execute on function app_private.refuse_notices_members() from public, anon, authenticated;
revoke execute on function app_private.guard_notices_channel() from public, anon, authenticated;
revoke execute on function app_private.guard_notice_message() from public, anon, authenticated;
revoke execute on function app_private.ensure_notices_channel(uuid) from public, anon, authenticated;

-- ============================================================== policies

-- Club staff only is club staff only.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (
    (select app_private.is_channel_member(channel_id))
    and (
      status = 'published'
      or sender_id = (select auth.uid())
      or ((select app_private.is_channel_host(channel_id)) and status <> 'scheduled')
    )
    and (audience = 'everyone' or (select app_private.sees_staff_notices(channel_id)))
  );

-- Notices are made by the competition, never by a client, and never deleted.
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)) and type <> 'notices');

drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated
  using (type not in ('direct', 'notices') and (select app_private.is_academy_staff(academy_id)));

-- Nobody reacts to a notice: who reacted is a list of names from every club.
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select app_private.is_channel_member(app_private.message_channel(message_id)))
    and not (select app_private.is_notices_channel(app_private.message_channel(message_id)))
  );

-- In Notices only the league says it is typing; anyone else's name would
-- reach every club in the competition.
drop policy if exists channel_members_may_say_they_are_typing on realtime.messages;
create policy channel_members_may_say_they_are_typing
  on realtime.messages for insert to authenticated
  with check (
    topic like 'channel:%'
    and (select app_private.is_channel_member((substring(topic from 9))::uuid))
    and (
      not (select app_private.is_notices_channel((substring(topic from 9))::uuid))
      or (select app_private.is_channel_host((substring(topic from 9))::uuid))
    )
  );

-- A club-staff notice's files sit under {org}/{channel}/{sender}/staff/ and
-- are as private as the notice.
drop policy if exists "attachments readable by channel members" on storage.objects;
create policy "attachments readable by channel members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and app_private.is_channel_member(((storage.foldername(name))[2])::uuid)
    and (
      (storage.foldername(name))[4] is distinct from 'staff'
      or app_private.sees_staff_notices(((storage.foldername(name))[2])::uuid)
    )
  );

-- ====================================================== the channel list

-- Notices appear in every organisation's list a person switches to: they are
-- about a competition, which belongs to no one club. Unread counts and the
-- preview count only what the person may read.
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
  ) x (channel_id, name, type, team_id, posting_mode, status, my_role, muted,
       unread_count, last_message_at, last_message_body, last_sender_name)
  order by (x.status = 'archived'), x.last_message_at desc nulls last, x.name;
$fn$;

-- Opening Notices records it in notice_reads; any other channel as before.
create or replace function public.mark_channel_read(p_channel uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_private.is_notices_channel(p_channel) then
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

-- ================================================================== push

-- As 0184, with Notices first: everyone in the competition, worked out now,
-- and only the club staff when the notice is for them. A notice is an
-- announcement — it ignores mute and quiet hours, and respects the person's
-- "announcements" switch.
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
  from public.channel_members cm
  join public.user_settings us on us.profile_id = cm.profile_id
  join public.academies a on a.id = new.academy_id
  where cm.channel_id = new.channel_id
    and cm.profile_id <> new.sender_id
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

-- ============================================================== seen by

-- C-01 for Notices: how many of the people a notice was for have opened the
-- channel since — a count for the league, never a name. Being in a
-- competition together is not seeing each other's people.
create or replace function public.notices_reach(p_channel uuid, p_message_ids uuid[])
returns table (message_id uuid, seen integer, total integer)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_competition uuid;
begin
  select c.competition_id into v_competition
    from public.channels c where c.id = p_channel and c.type = 'notices';
  if v_competition is null or not app_private.is_channel_host(p_channel) then
    return;
  end if;

  return query
    with people as (
      select np.profile_id, np.standing, nr.last_read_at
        from app_private.notices_people(v_competition) np
        left join public.notice_reads nr
          on nr.channel_id = p_channel and nr.profile_id = np.profile_id
    )
    select m.id,
           (count(*) filter (where p.last_read_at >= m.created_at))::integer,
           count(*)::integer
      from public.messages m
      join people p
        on p.profile_id <> m.sender_id
       and (m.audience = 'everyone' or p.standing in ('league', 'staff'))
     where m.channel_id = p_channel
       and m.id = any (p_message_ids)
     group by m.id;
end;
$fn$;

revoke execute on function public.notices_reach(uuid, uuid[]) from public, anon;
grant execute on function public.notices_reach(uuid, uuid[]) to authenticated;

-- ================================================ the old league broadcast

-- L-11's broadcast posted into each club's coaches channel and logged a row
-- any participant could read. It now posts into the competition's Notices,
-- to club staff only — the same people, in the one place notices live —
-- and returns how many clubs that reaches, as before.
create or replace function public.broadcast_to_competition(
  p_competition uuid,
  p_body        text,
  p_urgent      boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_channel uuid;
  v_org     uuid;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can send to the whole competition'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'nothing to send' using errcode = '22023';
  end if;

  v_channel := app_private.ensure_notices_channel(p_competition);
  select organiser_id into v_org from public.competitions where id = p_competition;

  insert into public.messages (academy_id, channel_id, sender_id, body, is_announcement, status, audience)
  values (v_org, v_channel, auth.uid(), btrim(p_body), true, 'published', 'club_staff');

  return (select count(*)::integer from public.competition_clubs cc
           where cc.competition_id = p_competition and cc.status = 'active');
end;
$$;

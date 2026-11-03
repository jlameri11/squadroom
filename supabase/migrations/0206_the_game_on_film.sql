-- 0206: the game, on film.
--
-- Matchdays (Joey, 3 Nov 2026; core, free). Inside the Fixtures tab a
-- second tab: Upcoming | Matchdays. Matchdays is the games already played —
-- the score, who scored, and the video. No Player of the Match there; that
-- is the game's own page.
--
-- The video is a link (Veo, an unlisted YouTube, a Google Drive file…) or an
-- upload. A coach adds it; one push goes to the squad's families — "U8 SPL
-- v Hornsby — video is up". Only the squad's people and the club's staff
-- see it: the table is behind RLS, the bucket behind the same rule, and
-- nothing about it is public. The coach is told, where they add it, that a
-- link follows that service's own privacy settings and can be forwarded,
-- while an upload stays private to the squad.

create table if not exists public.event_videos (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references public.academies(id) on delete cascade,
  event_id      uuid not null,
  kind          text not null check (kind in ('link', 'upload')),
  url           text check (url is null or url ~* '^https?://'),
  storage_path  text,
  title         text,
  added_by      uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint event_videos_link_or_upload check ((kind = 'link' and url is not null) or (kind = 'upload' and storage_path is not null)),
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade
);
create index if not exists event_videos_event_idx on public.event_videos (event_id, created_at);
alter table public.event_videos enable row level security;
drop policy if exists event_videos_read on public.event_videos;
create policy event_videos_read on public.event_videos for select to authenticated
  using ((select app_private.is_team_member(app_private.event_team(event_id)))
         or (select app_private.is_team_coach(app_private.event_team(event_id))));
-- Written only through add_match_video / remove_match_video.
grant select on public.event_videos to authenticated;

-- The uploads: private, under <academy>/<event>/, read by the squad's people,
-- written by its coaches. 50 MB — the project's file limit; bigger goes by link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('match-videos', 'match-videos', false, 52428800, array['video/mp4','video/quicktime','video/webm','video/x-m4v'])
on conflict (id) do nothing;
drop policy if exists match_videos_squad_read on storage.objects;
create policy match_videos_squad_read on storage.objects for select to authenticated
  using (bucket_id = 'match-videos'
         and (app_private.is_team_member(app_private.event_team(((storage.foldername(name))[2])::uuid))
              or app_private.is_team_coach(app_private.event_team(((storage.foldername(name))[2])::uuid))));
drop policy if exists match_videos_coach_insert on storage.objects;
create policy match_videos_coach_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'match-videos' and app_private.is_team_coach(app_private.event_team(((storage.foldername(name))[2])::uuid)));
drop policy if exists match_videos_coach_delete on storage.objects;
create policy match_videos_coach_delete on storage.objects for delete to authenticated
  using (bucket_id = 'match-videos' and app_private.is_team_coach(app_private.event_team(((storage.foldername(name))[2])::uuid)));

-- ------------------------------------------------------------- notification kinds
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.notification_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.notification_queue drop constraint %I', v_name);
  end if;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message','announcement','event_reminder','poll_opened','poll_closing','rsvp_change','invite',
    'event_cancelled','event_changed','event_back_on','rsvp_nudge','announcement_repeat','wwcc_expiring',
    'guardian_erased','official_rego_pending','reregister_nudge','offer','referee_appointment',
    'referee_response','referee_withdrawn','fixture_change_proposed','fixture_change_answered',
    'fixture_change_decided','mention','match_correction_requested','match_correction_decided',
    'fixture_flowing_open','discipline_warning','discipline_suspension','forfeit_request','forfeit_decided',
    'nomination','fee_due','fee_overdue','player_report','player_clip','selected','not_selected','match_day',
    'support_reply','match_video']));
end $$;

-- ---------------------------------------------------------------- adding one
drop function if exists public.add_match_video(uuid, text, text, text, text);
create or replace function public.add_match_video(p_event uuid, p_kind text, p_url text default null, p_path text default null, p_title text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e      public.events;
  v_id   uuid;
  v_team text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach adds the game video' using errcode = '42501';
  end if;
  if e.type not in ('match', 'tournament') then
    raise exception 'only a game has a video' using errcode = '22023';
  end if;
  if p_kind = 'link' then
    if coalesce(p_url, '') !~* '^https?://[^[:space:]]+$' then
      raise exception 'a video link is a web address (https://…)' using errcode = '22023';
    end if;
  elsif p_kind = 'upload' then
    if coalesce(p_path, '') !~ ('^' || e.academy_id::text || '/' || e.id::text || '/') then
      raise exception 'an upload lives under this game''s folder' using errcode = '22023';
    end if;
  else
    raise exception 'a video is a link or an upload' using errcode = '22023';
  end if;

  insert into public.event_videos (academy_id, event_id, kind, url, storage_path, title, added_by)
  values (e.academy_id, p_event, p_kind, case when p_kind = 'link' then btrim(p_url) end, case when p_kind = 'upload' then p_path end,
          nullif(btrim(coalesce(p_title, '')), ''), auth.uid())
  returning id into v_id;

  -- One push to the squad's families: the game, and that the video is up.
  select t.name into v_team from public.teams t where t.id = e.team_id;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  select e.academy_id, tm.profile_id, 'match_video',
         coalesce(v_team, 'Your squad') || coalesce(' v ' || e.opponent, '') || ' — video is up',
         case when p_kind = 'upload' then 'Uploaded by the coach; only this squad can see it.' else 'A link from the coach. Open the game to watch it.' end,
         '/calendar/' || p_event,
         jsonb_build_object('event_id', p_event, 'video_id', v_id),
         'video:' || v_id || ':' || tm.profile_id
    from public.team_members tm
   where tm.team_id = e.team_id and tm.profile_id <> auth.uid()
  on conflict (dedupe_key) do nothing;

  return public.matchday_videos(p_event);
end;
$fn$;
revoke execute on function public.add_match_video(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_match_video(uuid, text, text, text, text) to authenticated;

drop function if exists public.remove_match_video(uuid);
create or replace function public.remove_match_video(p_video uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  v public.event_videos;
begin
  select * into v from public.event_videos where id = p_video;
  if v.id is null or not coalesce(app_private.is_team_coach(app_private.event_team(v.event_id)), false) then
    raise exception 'only the squad''s coach removes the game video' using errcode = '42501';
  end if;
  delete from public.event_videos where id = p_video;
  return public.matchday_videos(v.event_id);
end;
$fn$;
revoke execute on function public.remove_match_video(uuid) from public, anon;
grant execute on function public.remove_match_video(uuid) to authenticated;

-- ----------------------------------------------------------------- reading
drop function if exists public.matchday_videos(uuid);
create or replace function public.matchday_videos(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  e public.events;
  v_coach boolean;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then return null; end if;
  v_coach := coalesce(app_private.is_team_coach(e.team_id), false);
  if not (v_coach or coalesce(app_private.is_team_member(e.team_id), false)) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_add', v_coach,
    'played', e.type in ('match', 'tournament') and e.starts_at <= now(),
    'videos', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'url', v.url, 'path', v.storage_path, 'title', v.title, 'at', v.created_at,
                                          'by', (select pr.full_name from public.profiles pr where pr.id = v.added_by)) order by v.created_at)
        from public.event_videos v where v.event_id = p_event), '[]'::jsonb));
end;
$fn$;
revoke execute on function public.matchday_videos(uuid) from public, anon;
grant execute on function public.matchday_videos(uuid) to authenticated;

-- The Matchdays tab: my squads' played games, newest first — the score, the
-- scorers, whether there is a video. The club's staff see every squad's.
-- No Player of the Match here, on purpose.
drop function if exists public.my_matchdays(uuid, integer);
create or replace function public.my_matchdays(p_academy uuid, p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_staff boolean := coalesce(app_private.is_academy_coach(p_academy), false);
begin
  if not coalesce(app_private.is_academy_member(p_academy), false) then
    raise exception 'not a member of that club' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'opponent', e.opponent, 'venue', e.venue,
             'team_id', e.team_id, 'team', (select t.name from public.teams t where t.id = e.team_id),
             'ours', coalesce(e.our_score, case when e.fixture_id is not null then (select case when ce.id = f.home_entry_id then f.home_score else f.away_score end from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id where f.id = e.fixture_id) end),
             'theirs', coalesce(e.their_score, case when e.fixture_id is not null then (select case when ce.id = f.home_entry_id then f.away_score else f.home_score end from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id where f.id = e.fixture_id) end),
             'scorers', coalesce((select jsonb_agg(jsonb_build_object('name', pl.full_name, 'goals', s.goals) order by s.goals desc, pl.full_name)
                                    from public.event_player_stats s join public.players pl on pl.id = s.player_id
                                   where s.event_id = e.id and s.goals > 0), '[]'::jsonb),
             'videos', (select count(*) from public.event_videos v where v.event_id = e.id))
           order by e.starts_at desc)
      from (
        select e.* from public.events e
         where e.academy_id = p_academy and e.type in ('match', 'tournament') and e.cancelled_at is null
           and e.private_to is null and e.starts_at <= now()
           and (v_staff or exists (select 1 from public.team_members tm where tm.team_id = e.team_id and tm.profile_id = auth.uid()))
         order by e.starts_at desc limit greatest(coalesce(p_limit, 40), 1)
      ) e), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.my_matchdays(uuid, integer) from public, anon;
grant execute on function public.my_matchdays(uuid, integer) to authenticated;

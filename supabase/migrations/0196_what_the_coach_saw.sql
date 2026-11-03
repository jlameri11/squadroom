-- 0196: what the coach saw — notes, a termly report, a clip.
--
-- G-05, and the first of W-09. What an academy sells is development, and
-- what a paying parent asks for is evidence of it. Three things, all on the
-- child's player card:
--
--   notes     a coach's private working notes on a player. Never shown to
--             the family — the thing a coach writes on the drive home.
--   reports   a termly report: a few paragraphs and four 1–5 ratings
--             (technical, tactical, physical, social). Private until the
--             coach shares it; sharing tells the family, once.
--   clips     a link to a video somewhere else (Veo, Hudl, YouTube, Analysis
--             Pro, a phone upload) — Squadroom hosts no video. A clip may
--             name the game it came from. Shared with the family by default,
--             never public, never on the match centre.
--
-- Who may write: the club's owner or admin, or a coach of the child's squad
-- with a current clearance. Who may read: the writers, and the family for
-- what is shared. A parent of a teammate sees none of it, and a child has
-- no account to see any of it with.

create table if not exists public.player_reports (
  id                  uuid primary key default gen_random_uuid(),
  academy_id          uuid not null references public.academies(id) on delete cascade,
  player_id           uuid not null,
  author_id           uuid references public.profiles(id) on delete set null,
  kind                text not null default 'note' check (kind in ('note', 'report')),
  term                text check (term is null or btrim(term) <> ''),
  body                text not null check (btrim(body) <> ''),
  ratings             jsonb not null default '{}'::jsonb check (jsonb_typeof(ratings) = 'object'),
  shared_with_family  boolean not null default false,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A note is the coach's own. Only a report can be shared.
  constraint player_reports_notes_stay_private check (kind = 'report' or not shared_with_family),
  foreign key (player_id, academy_id) references public.players(id, academy_id) on delete cascade
);
create index if not exists player_reports_player_idx on public.player_reports (player_id, created_at desc);

create table if not exists public.player_clips (
  id                  uuid primary key default gen_random_uuid(),
  academy_id          uuid not null references public.academies(id) on delete cascade,
  player_id           uuid not null,
  event_id            uuid references public.events(id) on delete set null,
  url                 text not null check (url ~* '^https?://[^[:space:]]+$' and length(url) <= 2000),
  title               text not null check (btrim(title) <> ''),
  note                text,
  added_by            uuid references public.profiles(id) on delete set null,
  shared_with_family  boolean not null default true,
  created_at          timestamptz not null default now(),
  foreign key (player_id, academy_id) references public.players(id, academy_id) on delete cascade
);
create index if not exists player_clips_player_idx on public.player_clips (player_id, created_at desc);

alter table public.player_reports enable row level security;
alter table public.player_clips enable row level security;

-- Who may write about a child: the club's owner or admin, or a coach of the
-- child's squad (is_team_coach also insists on a current clearance).
create or replace function app_private.may_develop(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.players p
     where p.id = p_player
       and (coalesce(app_private.is_academy_staff(p.academy_id), false)
            or (p.team_id is not null and coalesce(app_private.is_team_coach(p.team_id), false)))
  );
$$;
-- Called from the policies below as the signed-in role, so it needs this.
grant execute on function app_private.may_develop(uuid) to authenticated;

drop policy if exists player_reports_select on public.player_reports;
create policy player_reports_select on public.player_reports for select to authenticated
  using ((select app_private.may_develop(player_id))
         or (shared_with_family and (select app_private.is_guardian_of(player_id))));
drop policy if exists player_reports_insert on public.player_reports;
create policy player_reports_insert on public.player_reports for insert to authenticated
  with check ((select app_private.may_develop(player_id)) and author_id = auth.uid());
drop policy if exists player_reports_update on public.player_reports;
create policy player_reports_update on public.player_reports for update to authenticated
  using ((select app_private.may_develop(player_id))) with check ((select app_private.may_develop(player_id)));
drop policy if exists player_reports_delete on public.player_reports;
create policy player_reports_delete on public.player_reports for delete to authenticated
  using ((select app_private.may_develop(player_id)));

drop policy if exists player_clips_select on public.player_clips;
create policy player_clips_select on public.player_clips for select to authenticated
  using ((select app_private.may_develop(player_id))
         or (shared_with_family and (select app_private.is_guardian_of(player_id))));
drop policy if exists player_clips_insert on public.player_clips;
create policy player_clips_insert on public.player_clips for insert to authenticated
  with check ((select app_private.may_develop(player_id)) and added_by = auth.uid());
drop policy if exists player_clips_update on public.player_clips;
create policy player_clips_update on public.player_clips for update to authenticated
  using ((select app_private.may_develop(player_id))) with check ((select app_private.may_develop(player_id)));
drop policy if exists player_clips_delete on public.player_clips;
create policy player_clips_delete on public.player_clips for delete to authenticated
  using ((select app_private.may_develop(player_id)));

grant select, insert, update, delete on public.player_reports to authenticated;
grant select, insert, update, delete on public.player_clips to authenticated;

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
    'nomination','fee_due','fee_overdue','player_report','player_clip']));
end $$;

-- Tell the child's family something, once per person (the dedupe key).
-- The notification opens the card, not a home screen.
create or replace function app_private.tell_family(
  p_player uuid, p_kind text, p_title text, p_body text, p_payload jsonb, p_key text
) returns void language sql security definer set search_path = public as $$
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  select p.academy_id, pg.profile_id, p_kind, p_title, p_body,
         '/card/' || p.id || '#development', p_payload, p_key || ':' || pg.profile_id
    from public.players p
    join public.player_guardians pg on pg.player_id = p.id
   where p.id = p_player
  on conflict (dedupe_key) do nothing;
$$;
revoke execute on function app_private.tell_family(uuid, text, text, text, jsonb, text) from public, anon, authenticated;

create or replace function app_private.report_shared(p_report uuid)
returns void language sql security definer set search_path = public as $$
  select app_private.tell_family(
    r.player_id, 'player_report',
    coalesce(nullif(p.preferred_name, ''), split_part(p.full_name, ' ', 1)) || '''s '
      || coalesce(r.term || ' report', 'report') || ' from ' || coalesce(pr.full_name, 'the coach'),
    left(r.body, 140) || case when length(r.body) > 140 then '…' else '' end,
    jsonb_build_object('report_id', r.id, 'player_id', r.player_id),
    'report:' || r.id)
    from public.player_reports r
    join public.players p on p.id = r.player_id
    left join public.profiles pr on pr.id = r.author_id
   where r.id = p_report;
$$;
revoke execute on function app_private.report_shared(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- writing
drop function if exists public.write_player_report(uuid, text, text, text, jsonb, boolean);
create or replace function public.write_player_report(
  p_player uuid, p_kind text, p_body text,
  p_term text default null, p_ratings jsonb default '{}'::jsonb, p_share boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_player public.players;
  v_id     uuid;
  v_key    text;
  v_val    jsonb;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null or not app_private.may_develop(p_player) then
    raise exception 'only the club''s staff or the squad''s coach may write about a player' using errcode = '42501';
  end if;
  if p_kind not in ('note', 'report') then
    raise exception 'kind is note or report' using errcode = '22023';
  end if;
  if p_kind = 'note' and p_share then
    raise exception 'a note is the coach''s own; write a report to share one' using errcode = '22023';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'write something' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_ratings, '{}'::jsonb)) <> 'object' then
    raise exception 'ratings are an object' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(coalesce(p_ratings, '{}'::jsonb)) loop
    if v_key not in ('technical', 'tactical', 'physical', 'social') then
      raise exception 'unknown rating "%"', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric not in (1, 2, 3, 4, 5) then
      raise exception 'a rating is a whole number from 1 to 5' using errcode = '22023';
    end if;
  end loop;

  insert into public.player_reports (academy_id, player_id, author_id, kind, term, body, ratings, shared_with_family, published_at)
  values (v_player.academy_id, p_player, auth.uid(), p_kind, nullif(btrim(coalesce(p_term, '')), ''), btrim(p_body),
          coalesce(p_ratings, '{}'::jsonb), p_share, case when p_share then now() end)
  returning id into v_id;
  if p_share then perform app_private.report_shared(v_id); end if;
  return v_id;
end;
$fn$;
revoke execute on function public.write_player_report(uuid, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.write_player_report(uuid, text, text, text, jsonb, boolean) to authenticated;

drop function if exists public.share_player_report(uuid, boolean);
create or replace function public.share_player_report(p_report uuid, p_share boolean)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_report public.player_reports;
begin
  select * into v_report from public.player_reports where id = p_report;
  if v_report.id is null or not app_private.may_develop(v_report.player_id) then
    raise exception 'that report is not yours to share' using errcode = '42501';
  end if;
  if v_report.kind = 'note' and p_share then
    raise exception 'a note is the coach''s own; write a report to share one' using errcode = '22023';
  end if;
  update public.player_reports
     set shared_with_family = p_share,
         published_at = case when p_share then coalesce(published_at, now()) else published_at end,
         updated_at = now()
   where id = p_report;
  if p_share and not v_report.shared_with_family then
    perform app_private.report_shared(p_report);
  end if;
end;
$fn$;
revoke execute on function public.share_player_report(uuid, boolean) from public, anon;
grant execute on function public.share_player_report(uuid, boolean) to authenticated;

drop function if exists public.add_player_clip(uuid, text, text, text, uuid, boolean);
create or replace function public.add_player_clip(
  p_player uuid, p_url text, p_title text,
  p_note text default null, p_event uuid default null, p_share boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_player public.players;
  v_id     uuid;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null or not app_private.may_develop(p_player) then
    raise exception 'only the club''s staff or the squad''s coach may add a clip' using errcode = '42501';
  end if;
  if coalesce(p_url, '') !~* '^https?://[^[:space:]]+$' then
    raise exception 'a clip is a web link (https://…)' using errcode = '22023';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'give the clip a title' using errcode = '22023';
  end if;
  if p_event is not null and not exists (
    select 1 from public.events e where e.id = p_event and e.academy_id = v_player.academy_id
  ) then
    raise exception 'that game is not this club''s' using errcode = '22023';
  end if;

  insert into public.player_clips (academy_id, player_id, event_id, url, title, note, added_by, shared_with_family)
  values (v_player.academy_id, p_player, p_event, btrim(p_url), btrim(p_title), nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_share)
  returning id into v_id;

  if p_share then
    perform app_private.tell_family(
      p_player, 'player_clip',
      'A clip of ' || coalesce(nullif(v_player.preferred_name, ''), split_part(v_player.full_name, ' ', 1)) || ': ' || btrim(p_title),
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Open the card to watch it.'),
      jsonb_build_object('clip_id', v_id, 'player_id', p_player),
      'clip:' || v_id);
  end if;
  return v_id;
end;
$fn$;
revoke execute on function public.add_player_clip(uuid, text, text, text, uuid, boolean) from public, anon;
grant execute on function public.add_player_clip(uuid, text, text, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- reading
-- Everything the card's Development section shows, with the rule applied
-- here rather than trusted to the UI: the writers see all of it, the
-- family sees what is shared, anybody else is told no.
drop function if exists public.player_development(uuid);
create or replace function public.player_development(p_player uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player public.players;
  v_write  boolean;
  v_family boolean;
begin
  select * into v_player from public.players where id = p_player;
  v_write  := coalesce(app_private.may_develop(p_player), false);
  v_family := coalesce(app_private.is_guardian_of(p_player), false);
  if v_player.id is null or not (v_write or v_family) then
    raise exception 'that player''s development is not yours to see' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'player', jsonb_build_object('id', v_player.id, 'full_name', v_player.full_name, 'preferred_name', v_player.preferred_name),
    'can_write', v_write,
    'is_family', v_family,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'kind', r.kind, 'term', r.term, 'body', r.body, 'ratings', r.ratings,
               'shared', r.shared_with_family, 'published_at', r.published_at, 'created_at', r.created_at,
               'author', (select pr.full_name from public.profiles pr where pr.id = r.author_id),
               'mine', r.author_id = auth.uid())
             order by r.created_at desc)
        from public.player_reports r
       where r.player_id = p_player
         and (v_write or (r.shared_with_family and v_family))), '[]'::jsonb),
    'clips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'url', c.url, 'title', c.title, 'note', c.note,
               'shared', c.shared_with_family, 'created_at', c.created_at,
               'added_by', (select pr.full_name from public.profiles pr where pr.id = c.added_by),
               'event', (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'opponent', e.opponent)
                           from public.events e where e.id = c.event_id))
             order by c.created_at desc)
        from public.player_clips c
       where c.player_id = p_player
         and (v_write or (c.shared_with_family and v_family))), '[]'::jsonb),
    -- The squad's recent games, for "which game is this clip from".
    'games', case when v_write then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at desc)
        from (select e.id, e.title, e.starts_at from public.events e
               where e.academy_id = v_player.academy_id and e.team_id = v_player.team_id
                 and e.type = 'match' and e.cancelled_at is null and e.private_to is null
                 and e.starts_at < now() + interval '1 day'
               order by e.starts_at desc limit 12) e), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$fn$;
revoke execute on function public.player_development(uuid) from public, anon;
grant execute on function public.player_development(uuid) to authenticated;

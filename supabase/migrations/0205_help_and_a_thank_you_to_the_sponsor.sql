-- 0205: help, and a thank-you to the sponsor.
--
-- G-03 and X-08, two of M8's pieces that need no account from Joey.
--
--   support   "Help" in Settings: a person writes to Squadroom, Squadroom
--             writes back, the person is pushed. Threads live here, the
--             platform admins see the inbox, nobody else sees anybody
--             else's. A status page anyone can open says whether something
--             is known to be wrong.
--   sponsors  A club sells its own sponsor slots. The club keeps a list
--             (name, link, logo in a public bucket, which slots); the public
--             match centre shows them as a strip; the share cards carry a
--             "with thanks to" line; a count per day says how often the
--             strip was seen. Squadroom takes nothing from any of it.

-- ---------------------------------------------------------------- support
create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid references public.academies(id) on delete set null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  subject     text not null check (btrim(subject) <> ''),
  body        text not null check (btrim(body) <> ''),
  status      text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.support_replies (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.support_requests(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  from_staff  boolean not null default false,
  body        text not null check (btrim(body) <> ''),
  created_at  timestamptz not null default now()
);
create index if not exists support_requests_status_idx on public.support_requests (status, updated_at desc);
alter table public.support_requests enable row level security;
alter table public.support_replies enable row level security;
drop policy if exists support_requests_mine on public.support_requests;
create policy support_requests_mine on public.support_requests for select to authenticated
  using (profile_id = auth.uid() or (select app_private.is_platform_admin()));
drop policy if exists support_replies_mine on public.support_replies;
create policy support_replies_mine on public.support_replies for select to authenticated
  using (exists (select 1 from public.support_requests r where r.id = request_id and (r.profile_id = auth.uid() or (select app_private.is_platform_admin()))));
-- Written only through the functions below.
grant select on public.support_requests, public.support_replies to authenticated;

create table if not exists public.platform_status (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'notice' check (kind in ('notice', 'incident', 'resolved')),
  title       text not null check (btrim(title) <> ''),
  body        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.platform_status enable row level security;
drop policy if exists platform_status_admin on public.platform_status;
create policy platform_status_admin on public.platform_status for all to authenticated
  using ((select app_private.is_platform_admin())) with check ((select app_private.is_platform_admin()));
grant select, insert, update, delete on public.platform_status to authenticated;

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
    'support_reply']));
end $$;

drop function if exists public.open_support_request(text, text, uuid);
create or replace function public.open_support_request(p_subject text, p_body text, p_academy uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in' using errcode = '42501';
  end if;
  if p_academy is not null and not coalesce(app_private.is_academy_member(p_academy), false) then
    p_academy := null;
  end if;
  -- Ten open requests at once is a bug, not a conversation.
  if (select count(*) from public.support_requests r where r.profile_id = auth.uid() and r.status <> 'closed') >= 10 then
    raise exception 'you have ten open requests — we are on them' using errcode = '22023';
  end if;
  insert into public.support_requests (academy_id, profile_id, subject, body)
  values (p_academy, auth.uid(), btrim(p_subject), btrim(p_body))
  returning id into v_id;
  -- The platform admins are told, through the same queue as everything.
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  select coalesce(p_academy, (select am.academy_id from public.academy_members am where am.profile_id = pa.profile_id and am.status = 'active' limit 1)),
         pa.profile_id, 'support_reply', 'Support: ' || btrim(p_subject), left(btrim(p_body), 140), '/platform#support',
         jsonb_build_object('request_id', v_id), 'support:' || v_id || ':opened:' || pa.profile_id
    from public.platform_admins pa
   where exists (select 1 from public.academy_members am where am.profile_id = pa.profile_id and am.status = 'active')
  on conflict (dedupe_key) do nothing;
  return v_id;
end;
$fn$;
revoke execute on function public.open_support_request(text, text, uuid) from public, anon;
grant execute on function public.open_support_request(text, text, uuid) to authenticated;

drop function if exists public.reply_support(uuid, text);
create or replace function public.reply_support(p_request uuid, p_body text)
returns uuid language plpgsql volatile security definer set search_path = public as $fn$
declare
  r      public.support_requests;
  v_me   uuid := auth.uid();
  v_adm  boolean := coalesce(app_private.is_platform_admin(), false);
  v_id   uuid;
  v_acad uuid;
begin
  select * into r from public.support_requests where id = p_request;
  if r.id is null or not (r.profile_id = v_me or v_adm) then
    raise exception 'that request is not yours' using errcode = '42501';
  end if;
  insert into public.support_replies (request_id, profile_id, from_staff, body)
  values (p_request, v_me, v_adm and r.profile_id <> v_me, btrim(p_body))
  returning id into v_id;
  update public.support_requests
     set status = case when v_adm and r.profile_id <> v_me then 'answered' else 'open' end, updated_at = now()
   where id = p_request;
  if v_adm and r.profile_id <> v_me then
    -- The person asked; a push brings them back to the answer.
    select coalesce(r.academy_id, (select am.academy_id from public.academy_members am where am.profile_id = r.profile_id and am.status = 'active' limit 1)) into v_acad;
    if v_acad is not null then
      insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
      values (v_acad, r.profile_id, 'support_reply', 'Squadroom replied: ' || r.subject, left(btrim(p_body), 140), '/settings/help',
              jsonb_build_object('request_id', p_request, 'reply_id', v_id), 'support:' || v_id)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return v_id;
end;
$fn$;
revoke execute on function public.reply_support(uuid, text) from public, anon;
grant execute on function public.reply_support(uuid, text) to authenticated;

drop function if exists public.close_support_request(uuid);
create or replace function public.close_support_request(p_request uuid)
returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  r public.support_requests;
begin
  select * into r from public.support_requests where id = p_request;
  if r.id is null or not (r.profile_id = auth.uid() or coalesce(app_private.is_platform_admin(), false)) then
    raise exception 'that request is not yours' using errcode = '42501';
  end if;
  update public.support_requests set status = 'closed', updated_at = now() where id = p_request;
end;
$fn$;
revoke execute on function public.close_support_request(uuid) from public, anon;
grant execute on function public.close_support_request(uuid) to authenticated;

-- Mine, with replies; or, for a platform admin, everyone's.
drop function if exists public.support_threads(boolean);
create or replace function public.support_threads(p_inbox boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_adm boolean := coalesce(app_private.is_platform_admin(), false);
begin
  if auth.uid() is null then
    raise exception 'sign in' using errcode = '42501';
  end if;
  if p_inbox and not v_adm then
    raise exception 'the inbox is Squadroom''s' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'subject', r.subject, 'body', r.body, 'status', r.status,
             'created_at', r.created_at, 'updated_at', r.updated_at,
             'from', case when p_inbox then jsonb_build_object('name', pr.full_name, 'academy', a.name) end,
             'replies', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'body', x.body, 'from_staff', x.from_staff, 'at', x.created_at,
                                                                     'name', case when x.from_staff then 'Squadroom' else pr2.full_name end) order by x.created_at)
                                   from public.support_replies x left join public.profiles pr2 on pr2.id = x.profile_id where x.request_id = r.id), '[]'::jsonb))
           order by (r.status = 'closed'), r.updated_at desc)
      from public.support_requests r
      left join public.profiles pr on pr.id = r.profile_id
      left join public.academies a on a.id = r.academy_id
     where case when p_inbox then true else r.profile_id = auth.uid() end), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.support_threads(boolean) from public, anon;
grant execute on function public.support_threads(boolean) to authenticated;

-- The status page: anyone, no account. Only what the admins wrote.
drop function if exists public.public_status();
create or replace function public.public_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', not exists (select 1 from public.platform_status s where s.kind = 'incident' and s.resolved_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'body', s.body, 'at', s.created_at, 'resolved_at', s.resolved_at) order by s.created_at desc)
                        from (select * from public.platform_status order by created_at desc limit 20) s), '[]'::jsonb));
$$;
revoke execute on function public.public_status() from public;
grant execute on function public.public_status() to anon, authenticated;
insert into app_private.anon_callable (proname, why) values ('public_status', 'the status page: whether anything is known to be wrong, with no account')
on conflict do nothing;

-- --------------------------------------------------------------- sponsors
create table if not exists public.academy_sponsors (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  url         text check (url is null or url ~* '^https?://'),
  logo_url    text,
  tagline     text,
  slots       text[] not null default array['match_centre', 'cards'],
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists academy_sponsors_academy_idx on public.academy_sponsors (academy_id, active, sort);
create table if not exists public.sponsor_impressions (
  sponsor_id  uuid not null references public.academy_sponsors(id) on delete cascade,
  day         date not null,
  views       integer not null default 0,
  primary key (sponsor_id, day)
);
alter table public.academy_sponsors enable row level security;
alter table public.sponsor_impressions enable row level security;
drop policy if exists academy_sponsors_read on public.academy_sponsors;
create policy academy_sponsors_read on public.academy_sponsors for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
drop policy if exists academy_sponsors_write on public.academy_sponsors;
create policy academy_sponsors_write on public.academy_sponsors for all to authenticated
  using ((select app_private.is_academy_staff(academy_id))) with check ((select app_private.is_academy_staff(academy_id)));
drop policy if exists sponsor_impressions_read on public.sponsor_impressions;
create policy sponsor_impressions_read on public.sponsor_impressions for select to authenticated
  using (exists (select 1 from public.academy_sponsors s where s.id = sponsor_id and (select app_private.is_academy_staff(s.academy_id))));
grant select, insert, update, delete on public.academy_sponsors to authenticated;
grant select on public.sponsor_impressions to authenticated;

-- The logos: a public bucket, under the club's folder, written by its staff.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', true, 1048576, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;
drop policy if exists sponsor_logos_public_read on storage.objects;
create policy sponsor_logos_public_read on storage.objects for select to public using (bucket_id = 'sponsor-logos');
drop policy if exists sponsor_logos_staff_insert on storage.objects;
create policy sponsor_logos_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-logos' and app_private.is_academy_staff(((storage.foldername(name))[1])::uuid));
drop policy if exists sponsor_logos_staff_update on storage.objects;
create policy sponsor_logos_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'sponsor-logos' and app_private.is_academy_staff(((storage.foldername(name))[1])::uuid));
drop policy if exists sponsor_logos_staff_delete on storage.objects;
create policy sponsor_logos_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-logos' and app_private.is_academy_staff(((storage.foldername(name))[1])::uuid));

-- The strip on the public match centre: the organiser's sponsors, no account.
drop function if exists public.public_sponsors(text);
create or replace function public.public_sponsors(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'logo_url', s.logo_url, 'tagline', s.tagline) order by s.sort, s.name)
      from public.competitions c
      join public.academy_sponsors s on s.academy_id = c.organiser_id
     where c.public_slug = p_slug and c.published_at is not null
       and s.active and 'match_centre' = any (s.slots)), '[]'::jsonb);
$$;
revoke execute on function public.public_sponsors(text) from public;
grant execute on function public.public_sponsors(text) to anon, authenticated;
insert into app_private.anon_callable (proname, why) values ('public_sponsors', 'the sponsor strip on the public match centre: a name, a logo, a link — nothing about anyone')
on conflict do nothing;

-- The line on a club's share cards, for the signed-in staff rendering them.
drop function if exists public.card_sponsors(uuid);
create or replace function public.card_sponsors(p_academy uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when coalesce(app_private.is_academy_member(p_academy), false) then coalesce((
    select jsonb_agg(jsonb_build_object('name', s.name) order by s.sort, s.name)
      from public.academy_sponsors s
     where s.academy_id = p_academy and s.active and 'cards' = any (s.slots)), '[]'::jsonb) else '[]'::jsonb end;
$$;
revoke execute on function public.card_sponsors(uuid) from public, anon;
grant execute on function public.card_sponsors(uuid) to authenticated;

-- A day's views, counted by the server (the public page tells it once per load).
create or replace function public.count_sponsor_views(p_slug text)
returns integer language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer := 0;
begin
  insert into public.sponsor_impressions (sponsor_id, day, views)
  select s.id, (now() at time zone 'Australia/Sydney')::date, 1
    from public.competitions c
    join public.academy_sponsors s on s.academy_id = c.organiser_id
   where c.public_slug = p_slug and c.published_at is not null and s.active and 'match_centre' = any (s.slots)
  on conflict (sponsor_id, day) do update set views = public.sponsor_impressions.views + 1;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;
-- Service role only: the server route calls it; nobody from a browser.
revoke execute on function public.count_sponsor_views(text) from public, anon, authenticated;

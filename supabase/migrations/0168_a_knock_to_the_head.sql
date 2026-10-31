-- 0168: a knock to the head.
--
-- W-02. A child with a concussion must not play until a doctor says so,
-- and the way that fails is quiet: a coach who was not at Saturday's game
-- picks the sheet on Tuesday. Neither Squadi nor Dribl holds this. We do,
-- and we make the sheet refuse by name until the club has accepted a
-- medical clearance.
--
-- RECORDED by a coach or a parent — whoever saw it. CLEARED only by the
-- club, after a clearance (a letter, a form, a photo of one) is uploaded
-- into a private bucket that only the family and the club's coaches can
-- read. The lockout is enforced where it matters, in the sheet's
-- eligibility check (0151), and shown on the match-day card (0146/0159) so
-- the referee and the opposition see it too.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medical-clearances', 'medical-clearances', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Family and the club's coaches, and nobody else. Same path shape as the
-- photo: <academy>/<player>/<file>.
create or replace function app_private.may_see_clearance(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player uuid := app_private.photo_path_player(p_name);
  v_academy uuid;
begin
  if v_player is null then return false; end if;
  select academy_id into v_academy from public.players where id = v_player;
  if v_academy is null or (storage.foldername(p_name))[1] <> v_academy::text then
    return false;
  end if;
  return coalesce(app_private.is_guardian_of(v_player), false)
      or coalesce(app_private.is_academy_coach(v_academy), false);
end;
$fn$;

drop policy if exists "clearances readable by family and coaches" on storage.objects;
create policy "clearances readable by family and coaches"
  on storage.objects for select to authenticated
  using (bucket_id = 'medical-clearances' and app_private.may_see_clearance(name));
drop policy if exists "clearances written by family and coaches" on storage.objects;
create policy "clearances written by family and coaches"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'medical-clearances' and app_private.may_see_clearance(name));
drop policy if exists "clearances removed by family and coaches" on storage.objects;
create policy "clearances removed by family and coaches"
  on storage.objects for delete to authenticated
  using (bucket_id = 'medical-clearances' and app_private.may_see_clearance(name));

do $$ begin
  create type public.concussion_status as enum ('active', 'clearance_submitted', 'cleared');
exception when duplicate_object then null; end $$;

create table if not exists public.player_concussions (
  id                     uuid primary key default gen_random_uuid(),
  academy_id             uuid not null references public.academies(id) on delete cascade,
  player_id              uuid not null,
  occurred_on            date not null,
  note                   text,
  status                 public.concussion_status not null default 'active',
  recorded_by            uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  clearance_path         text,
  clearance_note         text,
  clearance_uploaded_at  timestamptz,
  clearance_uploaded_by  uuid references public.profiles(id) on delete set null,
  cleared_at             timestamptz,
  cleared_by             uuid references public.profiles(id) on delete set null,
  decision_note          text,
  constraint player_concussions_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
alter table public.player_concussions enable row level security;
create policy player_concussions_select on public.player_concussions for select to authenticated
  using ((select app_private.is_guardian_of(player_concussions.player_id))
         or (select app_private.is_academy_coach(player_concussions.academy_id)));
create index if not exists player_concussions_player_idx on public.player_concussions (player_id, status);

-- Why this child may not play, or null.
create or replace function app_private.concussion_reason(p_player uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select pl.full_name || ' has a recorded concussion (' || to_char(c.occurred_on, 'FMDD Mon') || ') — '
         || case c.status when 'clearance_submitted' then 'the medical clearance is waiting for the club to accept it'
                          else 'a medical clearance must be uploaded and accepted by the club first' end
    from public.player_concussions c
    join public.players pl on pl.id = c.player_id
   where c.player_id = p_player and c.status <> 'cleared'
   order by c.occurred_on desc
   limit 1;
$fn$;

create or replace function public.record_concussion(p_player uuid, p_occurred_on date, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_id uuid;
begin
  select academy_id into v_academy from public.players where id = p_player;
  if v_academy is null or not (coalesce(app_private.is_guardian_of(p_player), false) or coalesce(app_private.is_academy_coach(v_academy), false)) then
    raise exception 'only the family or the club records a concussion' using errcode = '42501';
  end if;
  if p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'when did it happen?' using errcode = '22023';
  end if;
  insert into public.player_concussions (academy_id, player_id, occurred_on, note, recorded_by)
  values (v_academy, p_player, p_occurred_on, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;

-- After the file is in the bucket: the family or the club says it is there.
create or replace function public.submit_concussion_clearance(p_concussion uuid, p_path text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_row public.player_concussions;
begin
  select * into v_row from public.player_concussions where id = p_concussion;
  if v_row.id is null or not (coalesce(app_private.is_guardian_of(v_row.player_id), false) or coalesce(app_private.is_academy_coach(v_row.academy_id), false)) then
    raise exception 'not yours' using errcode = '42501';
  end if;
  if v_row.status = 'cleared' then
    raise exception 'already cleared' using errcode = '22023';
  end if;
  if p_path is null or app_private.photo_path_player(p_path) <> v_row.player_id or (storage.foldername(p_path))[1] <> v_row.academy_id::text then
    raise exception 'that file is not under this child''s folder' using errcode = '22023';
  end if;
  update public.player_concussions
     set status = 'clearance_submitted', clearance_path = p_path, clearance_note = nullif(btrim(coalesce(p_note, '')), ''),
         clearance_uploaded_at = now(), clearance_uploaded_by = auth.uid(), decision_note = null
   where id = p_concussion;
end;
$fn$;

-- Only the club clears. A parent uploading a letter is not a parent
-- deciding their child may play.
create or replace function public.decide_concussion_clearance(p_concussion uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_row public.player_concussions;
begin
  select * into v_row from public.player_concussions where id = p_concussion;
  if v_row.id is null or not coalesce(app_private.is_academy_coach(v_row.academy_id), false) then
    raise exception 'only the club accepts a clearance' using errcode = '42501';
  end if;
  if v_row.status <> 'clearance_submitted' then
    raise exception 'there is no clearance waiting on this one' using errcode = '22023';
  end if;
  if p_accept then
    update public.player_concussions
       set status = 'cleared', cleared_at = now(), cleared_by = auth.uid(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_concussion;
  else
    update public.player_concussions
       set status = 'active', decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'not accepted')
     where id = p_concussion;
  end if;
end;
$fn$;

-- The sheet refuses a concussed child before anything else is asked.
create or replace function app_private.ineligibility(p_entry uuid, p_player uuid, p_on date default current_date)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_entry public.competition_entries;
  v_rank  integer;
  v_up    boolean;
  v_name  text;
  v_from  text;
  v_head  text;
begin
  select * into v_entry from public.competition_entries where id = p_entry;
  select full_name into v_name from public.players where id = p_player;
  if v_name is null then return 'no such player'; end if;

  v_head := app_private.concussion_reason(p_player);
  if v_head is not null then return v_head; end if;

  if exists (select 1 from public.entry_squads s where s.entry_id = p_entry and s.player_id = p_player) then
    return app_private.suspension_reason(v_entry.competition_id, p_player, p_on);
  end if;

  select d.rank, d.allow_playing_up into v_rank, v_up
    from public.competition_divisions d
   where d.competition_id = v_entry.competition_id and d.division = v_entry.division;

  select lower_e.division into v_from
    from public.entry_squads s
    join public.competition_entries lower_e on lower_e.id = s.entry_id
    join public.competition_divisions ld
      on ld.competition_id = lower_e.competition_id and ld.division = lower_e.division
   where s.player_id = p_player
     and lower_e.competition_id = v_entry.competition_id
     and lower_e.academy_id = v_entry.academy_id
     and lower_e.id <> v_entry.id
     and v_rank is not null and ld.rank is not null and ld.rank < v_rank
   limit 1;

  if v_from is not null then
    if coalesce(v_up, true) then
      return app_private.suspension_reason(v_entry.competition_id, p_player, p_on);
    end if;
    return v_name || ' is on the ' || v_from || ' squad and this division does not allow playing up';
  end if;

  return v_name || ' is not on this squad';
end;
$fn$;

-- The card says so, to the referee and the opposition.
create or replace function public.player_card(p_player uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null or not app_private.may_see_card(p_player) then
    raise exception 'that card is not yours to see' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id',              v_player.id,
    'full_name',       v_player.full_name,
    'preferred_name',  v_player.preferred_name,
    'dob',             v_player.dob,
    'photo_path',      v_player.photo_url,
    'ff_number',       v_player.ff_number,
    'official_status', v_player.official_status,
    'squad', (select jsonb_build_object('name', t.name, 'season', t.season, 'age_group', t.age_group)
                from public.teams t where t.id = v_player.team_id),
    'number', (select sn.number from public.squad_numbers sn
                where sn.player_id = v_player.id
                order by (sn.season = (select t.season from public.teams t where t.id = v_player.team_id)) desc,
                         sn.created_at desc
                limit 1),
    'club', (select jsonb_build_object('name', a.name, 'colour', a.primary_colour, 'logo_url', a.logo_url, 'slug', a.slug)
               from public.academies a where a.id = v_player.academy_id),
    'concussion', (select jsonb_build_object('occurred_on', c.occurred_on, 'status', c.status)
                     from public.player_concussions c
                    where c.player_id = v_player.id and c.status <> 'cleared'
                    order by c.occurred_on desc limit 1),
    'can_edit', coalesce(app_private.is_guardian_of(p_player), false)
                or coalesce(app_private.is_academy_coach(v_player.academy_id), false)
  );
end;
$fn$;

grant execute on function public.record_concussion(uuid, date, text) to authenticated;
grant execute on function public.submit_concussion_clearance(uuid, text, text) to authenticated;
grant execute on function public.decide_concussion_clearance(uuid, boolean, text) to authenticated;

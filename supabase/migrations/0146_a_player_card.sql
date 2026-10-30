-- 0146: a player card.
--
-- X-06 / DRIBL_PARITY #17. Dribl's digital player card — photo, name, date
-- of birth, squad, number — is what a referee or an opposition manager
-- checks at the ground, and the pieces of it have all existed here for
-- weeks (photo_url since 0082, numbers since 0085, the PlayFootball status
-- since 0137) with no photo ever uploaded and no card ever drawn.
--
-- THE PHOTO IS PRIVATE. A child's photograph is the single most sensitive
-- thing this product can hold, so: its own bucket, never public, read by
-- the child's guardians and the club's coaches and nobody else — not the
-- squad's other families, not the match centre, not a share card (R-16
-- publishes no photo anywhere and this changes nothing about that). The
-- path is <academy>/<player>/<file>, and the policies read the path, so a
-- photo cannot be put under another club's or another child's name.
--
-- players.photo_url holds the storage PATH, not a URL: a URL would be a
-- public address, and reading a photo means minting a short signed link
-- for a person the policy admits.
--
-- The card itself is a function, so the one set of rules — guardian or
-- coach — gates everything on it, and the league's match-day sheet (L-04)
-- can later ask the same function with its own right added.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/** The player a photo path belongs to, from <academy>/<player>/<file>. */
create or replace function app_private.photo_path_player(p_name text)
returns uuid
language sql immutable as $fn$
  select case when (storage.foldername(p_name))[2] ~ '^[0-9a-f-]{36}$'
              then (storage.foldername(p_name))[2]::uuid end;
$fn$;

create or replace function app_private.may_see_photo(p_name text)
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

drop policy if exists "player photos readable by family and coaches" on storage.objects;
create policy "player photos readable by family and coaches"
  on storage.objects for select to authenticated
  using (bucket_id = 'player-photos' and app_private.may_see_photo(name));

drop policy if exists "player photos written by family and coaches" on storage.objects;
create policy "player photos written by family and coaches"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos' and app_private.may_see_photo(name));

drop policy if exists "player photos replaced by family and coaches" on storage.objects;
create policy "player photos replaced by family and coaches"
  on storage.objects for update to authenticated
  using (bucket_id = 'player-photos' and app_private.may_see_photo(name));

drop policy if exists "player photos removed by family and coaches" on storage.objects;
create policy "player photos removed by family and coaches"
  on storage.objects for delete to authenticated
  using (bucket_id = 'player-photos' and app_private.may_see_photo(name));

create or replace function public.set_player_photo(p_player uuid, p_path text)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null
     or not (coalesce(app_private.is_guardian_of(p_player), false)
             or coalesce(app_private.is_academy_coach(v_player.academy_id), false)) then
    raise exception 'only the family or the club can set a player''s photo' using errcode = '42501';
  end if;
  -- The path must be this child's own folder, or the card would show
  -- whichever photo somebody pointed it at.
  if p_path is not null and (
       app_private.photo_path_player(p_path) is distinct from p_player
       or (storage.foldername(p_path))[1] <> v_player.academy_id::text) then
    raise exception 'that photo is not in this player''s folder' using errcode = '22023';
  end if;
  update public.players set photo_url = p_path, updated_at = now() where id = p_player;
end;
$fn$;

create or replace function public.player_card(p_player uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null
     or not (coalesce(app_private.is_guardian_of(p_player), false)
             or coalesce(app_private.is_academy_coach(v_player.academy_id), false)) then
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
    'can_edit', coalesce(app_private.is_guardian_of(p_player), false)
                or coalesce(app_private.is_academy_coach(v_player.academy_id), false)
  );
end;
$fn$;

revoke execute on function public.set_player_photo(uuid, text) from public, anon;
revoke execute on function public.player_card(uuid) from public, anon;
grant execute on function public.set_player_photo(uuid, text) to authenticated;
grant execute on function public.player_card(uuid) to authenticated;

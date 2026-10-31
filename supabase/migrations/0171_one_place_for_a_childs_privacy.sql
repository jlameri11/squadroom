-- 0171: one place for a child's privacy.
--
-- W-04. Everything that decides who sees what about a child already
-- exists — the club's naming rule (0093), the family's own opt-out, the
-- private photo (0146), the card's audience (0159), versioned consents
-- (0084, 0136), export and erase (0127) — in six places. A parent asking
-- "who can see my kid?" should get one answer, from the code that decides
-- it, not a screen's paraphrase. child_privacy returns the facts; the
-- family screen shows them; the public pages link to a notice a child can
-- read.

create or replace function public.child_privacy(p_player uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player public.players;
  v_academy public.academies;
  v_effective text;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null or not (coalesce(app_private.is_guardian_of(p_player), false) or coalesce(app_private.is_academy_coach(v_player.academy_id), false)) then
    raise exception 'not your child' using errcode = '42501';
  end if;
  select * into v_academy from public.academies where id = v_player.academy_id;
  v_effective := case
    when v_player.public_name_hidden then 'hidden'
    when v_academy.public_player_names = 'full' then 'full name'
    when v_academy.public_player_names = 'initials' then 'first name and initial'
    else 'hidden'
  end;
  return jsonb_build_object(
    'club', v_academy.name,
    'club_rule', v_academy.public_player_names,
    'name_hidden', v_player.public_name_hidden,
    'effective_public_name', v_effective,
    'has_photo', v_player.photo_url is not null,
    'official_status', v_player.official_status,
    -- Who can open the card, by the rule in 0159.
    'card_audience', jsonb_build_array(
      'you and the other guardians',
      v_academy.name || '''s coaches and admins'
    ) || coalesce((
      select jsonb_agg(distinct a.name || ' (officials of ' || c.name || ')')
        from public.entry_squads q
        join public.competitions c on c.id = q.competition_id
        join public.academies a on a.id = c.organiser_id
       where q.player_id = p_player
    ), '[]'::jsonb) || jsonb_build_array('the other team''s manager, on match day only, when ' || split_part(v_player.full_name, ' ', 1) || ' is on the sheet'),
    'public_squads', coalesce((
      select jsonb_agg(distinct c.name)
        from public.competition_entries e
        join public.competitions c on c.id = e.competition_id
       where e.team_id = v_player.team_id and e.academy_id = v_player.academy_id
         and c.public_slug is not null and c.published_at is not null
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('title', d.title, 'kind', d.kind, 'version', d.version, 'accepted', ca.accepted, 'at', ca.accepted_at) order by d.title)
        from public.consent_documents d
        left join public.consent_acceptances ca on ca.document_id = d.id and ca.player_id = p_player
       where d.academy_id = v_player.academy_id and d.published_at is not null and d.retired_at is null
    ), '[]'::jsonb),
    'medical_readers', v_academy.name || '''s owners, admins and coaches — never another club, never a league',
    'phone_rule', v_academy.directory_visibility
  );
end;
$fn$;

-- A guardian or the club decides whether the child is named in public.
-- The family's "hidden" always wins over the club's rule (0093).
create or replace function public.set_child_public_name(p_player uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.players where id = p_player;
  if v_academy is null or not (coalesce(app_private.is_guardian_of(p_player), false) or coalesce(app_private.is_academy_coach(v_academy), false)) then
    raise exception 'not your child' using errcode = '42501';
  end if;
  update public.players set public_name_hidden = p_hidden, updated_at = now() where id = p_player;
end;
$fn$;

grant execute on function public.child_privacy(uuid) to authenticated;
grant execute on function public.set_child_public_name(uuid, boolean) to authenticated;

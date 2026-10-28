-- 0128: S-04. Before you post that photo.
--
-- R-06 records photo consent, versioned, including a refusal — kept as
-- carefully as a yes, which is the whole point of recording an answer rather
-- than a permission. Nothing in the product has ever read it back.
--
-- So a coach can photograph a training session and post it into a team chat
-- containing the family who said no, and nobody finds out until the family
-- does.
--
-- WHAT THIS CANNOT DO, and saying so is the design: it cannot tell who is in
-- a photograph. Pretending otherwise — "we checked the image" — would be
-- worse than silence, because a coach would trust it. It tells a coach WHO
-- IN THIS SQUAD must not be photographed, at the moment they are about to
-- post, and leaves the looking to the human who was there.
--
-- A REFUSAL AND AN UNANSWERED FORM ARE DIFFERENT THINGS and are never
-- merged. A refusal is a decision a family made and is a hard no. An
-- unanswered form is a question the club has not asked yet, and treating it
-- as a refusal would make the warning fire for every child at a club that
-- has just started — which is a warning nobody reads, and a warning nobody
-- reads is worse than none because it trains people past the real one.
--
-- And a club with no photo consent document at all gets nothing. It does not
-- track this, and a prompt about a policy it has not adopted is noise.

/**
 * Who in this channel's squad must not be photographed.
 *
 * Takes the CHANNEL, not the team, because that is what the composer knows
 * and because an academy-wide channel has no squad to check — it returns
 * nothing there rather than every child in the club, which would be a list
 * nobody could act on.
 *
 * Staff only. The list names children and their families' decisions.
 */
create or replace function public.photo_consent_check(p_channel uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_channel public.channels;
  v_doc     public.consent_documents;
  v_squad   integer;
  v_refused jsonb;
  v_unasked jsonb;
begin
  select * into v_channel from public.channels where id = p_channel;
  if v_channel.id is null then
    return null;
  end if;

  if not coalesce(app_private.is_academy_coach(v_channel.academy_id), false) then
    return null;
  end if;

  -- No squad, nothing to check. An academy-wide channel would otherwise
  -- produce every child in the club.
  if v_channel.team_id is null then
    return jsonb_build_object('applies', false, 'reason', 'no_team');
  end if;

  select * into v_doc
    from public.consent_documents
   where academy_id = v_channel.academy_id
     and kind = 'photo_media'
     and published_at is not null
     and retired_at is null
   order by version desc
   limit 1;

  -- A club that does not track photo consent gets no prompt about it.
  if v_doc.id is null then
    return jsonb_build_object('applies', false, 'reason', 'no_policy');
  end if;

  select count(*)::integer into v_squad
    from public.players pl
   where pl.academy_id = v_channel.academy_id and pl.team_id = v_channel.team_id;

  -- Said no. A decision a family made, against the version they were shown.
  select jsonb_agg(jsonb_build_object(
           'player_id', pl.id,
           'name', coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name)
         ) order by pl.full_name)
    into v_refused
    from public.players pl
    join public.consent_acceptances ca
      on ca.player_id = pl.id and ca.document_id = v_doc.id
   where pl.academy_id = v_channel.academy_id
     and pl.team_id = v_channel.team_id
     and ca.accepted = false;

  -- Never asked, or never answered. A question, not a refusal.
  select jsonb_agg(jsonb_build_object(
           'player_id', pl.id,
           'name', coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name)
         ) order by pl.full_name)
    into v_unasked
    from public.players pl
   where pl.academy_id = v_channel.academy_id
     and pl.team_id = v_channel.team_id
     and not exists (
       select 1 from public.consent_acceptances ca
        where ca.player_id = pl.id and ca.document_id = v_doc.id
     );

  return jsonb_build_object(
    'applies', true,
    'document', v_doc.title,
    'version', v_doc.version,
    'squad_size', v_squad,
    'refused', coalesce(v_refused, '[]'::jsonb),
    'not_answered', coalesce(v_unasked, '[]'::jsonb),
    -- So a screen can say "nobody has answered yet" instead of listing
    -- twenty-six names, which is the difference between a prompt a coach
    -- acts on and one they learn to dismiss.
    'nobody_has_answered', coalesce(jsonb_array_length(v_unasked), 0) = v_squad
  );
end;
$fn$;

revoke execute on function public.photo_consent_check(uuid) from public, anon;
grant execute on function public.photo_consent_check(uuid) to authenticated;

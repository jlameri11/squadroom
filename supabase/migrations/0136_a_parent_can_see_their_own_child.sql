-- 0136: a parent can see their own child.
--
-- R-17. Medical (0082), kit sizes (0123), squad numbers (0085) and consents
-- (0084) were all built, and every one of them was admin- and coach-side
-- only. A parent's single route to their own child's record was the JSON
-- data export. "Settings → My family" was a cell in a table in the spec,
-- which is how it stayed unbuilt while every field behind it got built.
--
-- Three things:
--
-- 1. my_family() — the children the caller is a guardian of, and what the
--    club holds about each. Scoped by is_guardian_of; a coach calling it
--    gets their own children, not their squad. The consents carry THE
--    FAMILY'S ANSWER, computed the way the readers already read it:
--    photo_consent_check (0128) treats any row with accepted = false as a
--    refusal, and no row as unanswered. So: refused if any guardian has
--    withdrawn, agreed if someone agreed and nobody withdrew, null if
--    nobody has answered.
--
-- 2. set_consent(player, document, accepted) — the caller's OWN row,
--    upserted. It never touches another adult's record: a withdrawal by
--    one parent stands until that parent reverses it, which is what
--    "either guardian may refuse" has to mean. Recorded, never deleted
--    (0084): a refusal is kept as carefully as a yes, and the club's photo
--    warning reads it the moment it is made.
--
-- 3. set_kit_sizes now lets a guardian record their own child's size. It
--    refused anyone but staff and the team coach — but "what size do they
--    take" is a question a club asks the family, and the family answering
--    it themselves is the whole point of a screen like this.

create or replace function public.my_family()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(child order by child->>'full_name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',             pl.id,
               'academy_id',     pl.academy_id,
               'club',           a.name,
               'full_name',      pl.full_name,
               'preferred_name', pl.preferred_name,
               'dob',            pl.dob,
               'gender',         pl.gender,
               'school',         pl.school,
               'ff_number',      pl.ff_number,
               'relationship',   pg.relationship,
               'kit', jsonb_build_object(
                 'shirt',  pl.shirt_size,
                 'shorts', pl.shorts_size,
                 'socks',  pl.socks_size
               ),
               'squad', (
                 select jsonb_build_object('id', t.id, 'name', t.name, 'season', t.season)
                   from public.teams t where t.id = pl.team_id
               ),
               -- The number for the squad's season; failing a squad, the
               -- most recent one they were given.
               'number', (
                 select sn.number
                   from public.squad_numbers sn
                  where sn.player_id = pl.id
                  order by (sn.season = (select t.season from public.teams t where t.id = pl.team_id)) desc,
                           sn.created_at desc
                  limit 1
               ),
               'medical', (
                 select jsonb_build_object(
                          'conditions',         m.conditions,
                          'allergies',          m.allergies,
                          'medications',        m.medications,
                          'dietary',            m.dietary,
                          'emergency_name',     m.emergency_name,
                          'emergency_phone',    m.emergency_phone,
                          'emergency_relation', m.emergency_relation,
                          'doctor_name',        m.doctor_name,
                          'doctor_phone',       m.doctor_phone,
                          'first_aid_consent',  m.first_aid_consent
                        )
                   from public.player_medical m where m.player_id = pl.id
               ),
               'consents', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'document_id', d.id,
                          'title',       d.title,
                          'kind',        d.kind,
                          'version',     d.version,
                          'required',    d.required,
                          'accepted',    ans.accepted,
                          'accepted_at', ans.accepted_at,
                          'mine',        ans.profile_id = auth.uid()
                        ) order by d.required desc, d.title)
                   from public.consent_documents d
                   left join lateral (
                     -- The family's answer: a withdrawal outranks an
                     -- agreement, the newest of each kind wins.
                     select ca.accepted, ca.accepted_at, ca.profile_id
                       from public.consent_acceptances ca
                      where ca.document_id = d.id and ca.player_id = pl.id
                      order by (ca.accepted = false) desc, ca.accepted_at desc
                      limit 1
                   ) ans on true
                  where d.academy_id = pl.academy_id
                    and d.published_at is not null
                    and d.retired_at is null
               ), '[]'::jsonb)
             ) as child
        from public.player_guardians pg
        join public.players pl on pl.id = pg.player_id
        join public.academies a on a.id = pl.academy_id
       where pg.profile_id = auth.uid()
    ) s;
$fn$;

revoke execute on function public.my_family() from public, anon;
grant execute on function public.my_family() to authenticated;

create or replace function public.set_consent(p_player uuid, p_document uuid, p_accepted boolean)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_player   public.players;
  v_document public.consent_documents;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  select * into v_player from public.players where id = p_player;
  if v_player.id is null or not coalesce(app_private.is_guardian_of(p_player), false) then
    raise exception 'only a guardian can answer for a child' using errcode = '42501';
  end if;
  select * into v_document from public.consent_documents
   where id = p_document and academy_id = v_player.academy_id
     and published_at is not null and retired_at is null;
  if v_document.id is null then
    raise exception 'that agreement is not one this club is asking for' using errcode = '22023';
  end if;

  insert into public.consent_acceptances (academy_id, document_id, profile_id, player_id, accepted, accepted_at)
  values (v_player.academy_id, p_document, v_me, p_player, p_accepted, now())
  on conflict (document_id, profile_id, player_id)
  do update set accepted = excluded.accepted, accepted_at = excluded.accepted_at;
end;
$fn$;

revoke execute on function public.set_consent(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_consent(uuid, uuid, boolean) to authenticated;

create or replace function public.set_kit_sizes(
  p_player uuid,
  p_shirt  public.kit_size default null,
  p_shorts public.kit_size default null,
  p_socks  public.sock_size default null
)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null then
    raise exception 'no such player' using errcode = '22023';
  end if;

  if not (coalesce(app_private.is_academy_staff(v_player.academy_id), false)
          or (v_player.team_id is not null
              and coalesce(app_private.is_team_coach(v_player.team_id), false))
          -- 0136: the family may answer this themselves.
          or coalesce(app_private.is_guardian_of(p_player), false)) then
    raise exception 'only a coach or a parent can record kit sizes' using errcode = '42501';
  end if;

  update public.players
     set shirt_size = p_shirt,
         shorts_size = p_shorts,
         socks_size = p_socks,
         updated_at = now()
   where id = p_player;
end;
$fn$;

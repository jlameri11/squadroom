-- 0029_competition_invites.sql
--
-- How an event group with no clubs on the platform fills a competition.
--
-- The same shape as a parent joining a team, one level up:
--   parent  → team link  → coach approves  → in the team
--   club    → comp link  → claims an entry → in the competition
--
-- The organiser builds the whole draw first, from names alone. Each name is
-- a competition_entry with a null academy_id, which already works. An invite
-- is then a token attached to one of those names, and redeeming it points
-- that entry at a real organisation.
--
-- This matters because the organiser cannot wait for 120 clubs to sign up
-- before making a draw, and a club will not sign up for a competition it
-- cannot see itself in.

create table public.competition_invites (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  entry_id       uuid references public.competition_entries(id) on delete cascade,
  club_name      text not null check (length(btrim(club_name)) > 0),

  contact_name   text,
  contact_email  citext,
  contact_phone  text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),

  token          text not null unique default encode(gen_random_bytes(16), 'hex'),
  status         text not null default 'pending'
                   check (status in ('pending', 'claimed', 'declined', 'revoked', 'expired')),

  redeemed_academy uuid references public.academies(id) on delete set null,
  redeemed_by      uuid references public.profiles(id) on delete set null,
  redeemed_at      timestamptz,

  invited_by     uuid not null references public.profiles(id) on delete cascade,
  expires_at     timestamptz not null default now() + interval '90 days',
  created_at     timestamptz not null default now()
);
alter table public.competition_invites enable row level security;

create index competition_invites_comp_idx on public.competition_invites (competition_id, status);

create policy competition_invites_all on public.competition_invites for all to authenticated
  using ((select app_private.is_competition_organiser(competition_id)))
  with check ((select app_private.is_competition_organiser(competition_id)));

-- What a club sees before deciding: enough to recognise itself, nothing else.
-- Deliberately does not expose the rest of the draw - the other 119 clubs and
-- their contact details are not this person's business until they are in.
create or replace function public.peek_competition_invite(p_token text)
returns table (
  competition_name text,
  organiser_name   text,
  club_name        text,
  division         text,
  starts_on        date,
  status           text
)
language sql stable security definer set search_path = public as $$
  select c.name, o.name, ci.club_name, e.division, c.starts_on,
         case when ci.expires_at < now() and ci.status = 'pending' then 'expired' else ci.status end
    from public.competition_invites ci
    join public.competitions c on c.id = ci.competition_id
    join public.academies o on o.id = c.organiser_id
    left join public.competition_entries e on e.id = ci.entry_id
   where ci.token = p_token;
$$;

grant execute on function public.peek_competition_invite(text) to anon, authenticated;

create or replace function public.claim_competition_invite(
  p_token   text,
  p_academy uuid,
  p_team    uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  ci    public.competition_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  -- You may only bring in an organisation you actually run.
  if not app_private.is_academy_staff(p_academy) then
    raise exception 'you must be an owner or admin of that organisation'
      using errcode = '42501';
  end if;

  select * into ci from public.competition_invites where token = p_token for update;

  if ci.id is null or ci.status <> 'pending' or ci.expires_at < now() then
    raise exception 'this invitation is no longer valid' using errcode = '22023';
  end if;

  insert into public.competition_clubs (competition_id, academy_id, status, invited_by, joined_at)
  values (ci.competition_id, p_academy, 'active', ci.invited_by, now())
  on conflict (competition_id, academy_id) do update
    set status = 'active', joined_at = coalesce(public.competition_clubs.joined_at, now());

  -- The name on the draw becomes their team. Fixtures already point at this
  -- entry, so every game scheduled before they signed up is now theirs.
  if ci.entry_id is not null then
    update public.competition_entries
       set academy_id = p_academy,
           team_id    = p_team
     where id = ci.entry_id;
  end if;

  update public.competition_invites
     set status = 'claimed', redeemed_academy = p_academy,
         redeemed_by = v_uid, redeemed_at = now()
   where id = ci.id;

  return ci.competition_id;
end;
$$;

revoke execute on function public.claim_competition_invite(text, uuid, uuid) from public, anon;
grant execute on function public.claim_competition_invite(text, uuid, uuid) to authenticated;

-- Bulk: paste a list of club names, get a draw and an invite for each.
-- An organiser is not entering 120 clubs one at a time.
create or replace function public.bulk_invite_clubs(
  p_competition uuid,
  p_division    text,
  p_clubs       jsonb   -- [{ "club_name": "...", "contact_email": "...", "group_label": "A" }]
) returns table (club_name text, token text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  rec   jsonb;
  v_entry uuid;
  v_token text;
  v_name  text;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can invite clubs' using errcode = '42501';
  end if;

  for rec in select * from jsonb_array_elements(p_clubs)
  loop
    v_name := btrim(rec ->> 'club_name');
    continue when v_name is null or v_name = '';

    insert into public.competition_entries (competition_id, display_name, division, group_label)
    values (p_competition, v_name, p_division, rec ->> 'group_label')
    on conflict (competition_id, division, display_name) do update
      set group_label = coalesce(excluded.group_label, public.competition_entries.group_label)
    returning id into v_entry;

    insert into public.competition_invites
      (competition_id, entry_id, club_name, contact_email, contact_name, invited_by)
    values
      (p_competition, v_entry, v_name, nullif(rec ->> 'contact_email','')::citext,
       nullif(rec ->> 'contact_name',''), v_uid)
    returning competition_invites.token into v_token;

    club_name := v_name;
    token := v_token;
    return next;
  end loop;
end;
$$;

revoke execute on function public.bulk_invite_clubs(uuid, text, jsonb) from public, anon;
grant execute on function public.bulk_invite_clubs(uuid, text, jsonb) to authenticated;

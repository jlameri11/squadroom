-- 0167: a team enters, and the league is paid.
--
-- L-02 and L-16, the halves that do not need a Stripe key.
--
-- ENTRY FEES (L-02). A league charges clubs to enter — per division, or one
-- fee for all. The fee is OWED by an entry the moment it exists, paid by
-- whichever club claims that entry, and the treasurer records how: bank
-- transfer or cash today, Stripe Connect to the league's account once the
-- key exists (B-09 / L-02's other half). A club sees what it owes to whom,
-- with the league's own payment instructions. Squadroom takes nothing.
--
-- TOURNAMENT ENTRY (L-16). Visiting teams enter from the public page: a
-- club name, a team, a division and a contact, with no account. The
-- organiser accepts (choosing the division) and the request becomes an
-- entry on the draw plus an invitation the club claims with the existing
-- /join-competition link — the same path a club invited by the organiser
-- takes, so there is one way in. The fee is raised by the trigger. Paying
-- online at entry is the Stripe half, and waits for the key; until then
-- the entry says "pay by bank transfer" with the league's instructions.

-- ---------------------------------------------------------------------
-- Fees
-- ---------------------------------------------------------------------
create table if not exists public.competition_fees (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  -- '' means every division without its own row.
  division       text not null default '',
  fee_cents      integer not null check (fee_cents between 0 and 1000000),
  instructions   text,
  updated_at     timestamptz not null default now(),
  primary key (competition_id, division)
);
alter table public.competition_fees enable row level security;
-- Participants see the fees (a club needs to know what it owes); only the
-- organiser writes, through set_competition_fee.
create policy competition_fees_select on public.competition_fees for select to authenticated
  using ((select app_private.is_competition_participant(competition_fees.competition_id)));

do $$ begin
  create type public.entry_fee_status as enum ('owed', 'paid', 'waived');
exception when duplicate_object then null; end $$;

create table if not exists public.entry_fees (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  entry_id        uuid not null unique references public.competition_entries(id) on delete cascade,
  academy_id      uuid not null references public.academies(id) on delete cascade,
  club_academy_id uuid references public.academies(id) on delete set null,
  amount_cents    integer not null check (amount_cents >= 0),
  status          public.entry_fee_status not null default 'owed',
  paid_at         timestamptz,
  method          text check (method is null or method in ('bank', 'cash', 'stripe')),
  note            text,
  created_at      timestamptz not null default now()
);
alter table public.entry_fees enable row level security;
create policy entry_fees_select on public.entry_fees for select to authenticated
  using ((select app_private.may_run(entry_fees.competition_id, 'competition'))
         or (club_academy_id is not null and (select app_private.is_academy_staff(entry_fees.club_academy_id))));
create index if not exists entry_fees_competition_idx on public.entry_fees (competition_id, status);

create or replace function app_private.fee_for(p_competition uuid, p_division text)
returns integer language sql stable security definer set search_path = public as $fn$
  select fee_cents from public.competition_fees
   where competition_id = p_competition and division in (coalesce(p_division, ''), '')
   order by (division <> '') desc
   limit 1;
$fn$;

-- An entry owes the fee the moment it exists; a claimed entry carries the
-- club that owes it.
create or replace function public.raise_entry_fee()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_fee integer;
  v_org uuid;
begin
  if tg_op = 'INSERT' then
    v_fee := app_private.fee_for(new.competition_id, new.division);
    if v_fee is not null then
      select organiser_id into v_org from public.competitions where id = new.competition_id;
      insert into public.entry_fees (competition_id, entry_id, academy_id, club_academy_id, amount_cents)
      values (new.competition_id, new.id, v_org, new.academy_id, v_fee)
      on conflict (entry_id) do nothing;
    end if;
  elsif new.academy_id is distinct from old.academy_id then
    update public.entry_fees set club_academy_id = new.academy_id where entry_id = new.id;
  end if;
  return new;
end;
$fn$;
drop trigger if exists competition_entries_raise_fee on public.competition_entries;
create trigger competition_entries_raise_fee
  after insert or update of academy_id on public.competition_entries
  for each row execute function public.raise_entry_fee();

create or replace function public.set_competition_fee(p_competition uuid, p_division text, p_fee_cents integer, p_instructions text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid;
begin
  if not app_private.may_run(p_competition, 'competition') then
    raise exception 'only the organiser sets entry fees' using errcode = '42501';
  end if;
  select organiser_id into v_org from public.competitions where id = p_competition;
  insert into public.competition_fees (competition_id, division, fee_cents, instructions)
  values (p_competition, coalesce(p_division, ''), p_fee_cents, nullif(btrim(coalesce(p_instructions, '')), ''))
  on conflict (competition_id, division) do update
    set fee_cents = excluded.fee_cents,
        instructions = coalesce(excluded.instructions, public.competition_fees.instructions),
        updated_at = now();
  -- Entries that exist already and owe nothing yet.
  insert into public.entry_fees (competition_id, entry_id, academy_id, club_academy_id, amount_cents)
  select e.competition_id, e.id, v_org, e.academy_id, app_private.fee_for(e.competition_id, e.division)
    from public.competition_entries e
   where e.competition_id = p_competition
     and (coalesce(p_division, '') = '' or e.division = p_division)
     and app_private.fee_for(e.competition_id, e.division) is not null
  on conflict (entry_id) do nothing;
end;
$fn$;

create or replace function public.mark_entry_fee(p_fee uuid, p_status public.entry_fee_status, p_method text default 'bank', p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_fee public.entry_fees;
begin
  select * into v_fee from public.entry_fees where id = p_fee;
  if v_fee.id is null or not app_private.may_run(v_fee.competition_id, 'competition') then
    raise exception 'only the organiser records an entry fee' using errcode = '42501';
  end if;
  if p_status = 'paid' and p_method not in ('bank', 'cash', 'stripe') then
    raise exception 'paid how? bank, cash or stripe' using errcode = '22023';
  end if;
  update public.entry_fees
     set status = p_status,
         paid_at = case when p_status = 'paid' then now() end,
         method = case when p_status = 'paid' then p_method end,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = p_fee;
end;
$fn$;

-- The organiser's view: the fee schedule and every entry's fee.
create or replace function public.competition_fees_view(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not app_private.may_run(p_competition, 'competition') then null
    else jsonb_build_object(
      'fees', coalesce((select jsonb_agg(jsonb_build_object('division', f.division, 'fee_cents', f.fee_cents, 'instructions', f.instructions) order by f.division)
                          from public.competition_fees f where f.competition_id = p_competition), '[]'::jsonb),
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'fee_id', x.id, 'entry_id', e.id, 'team', e.display_name, 'division', e.division,
                 'club', a.name, 'claimed', e.academy_id is not null,
                 'amount_cents', x.amount_cents, 'status', x.status, 'paid_at', x.paid_at, 'method', x.method, 'note', x.note
               ) order by e.division, e.display_name)
          from public.entry_fees x
          join public.competition_entries e on e.id = x.entry_id
          left join public.academies a on a.id = e.academy_id
         where x.competition_id = p_competition
      ), '[]'::jsonb),
      'owed_cents', coalesce((select sum(amount_cents) from public.entry_fees where competition_id = p_competition and status = 'owed'), 0),
      'paid_cents', coalesce((select sum(amount_cents) from public.entry_fees where competition_id = p_competition and status = 'paid'), 0)
    )
  end;
$fn$;

-- A club's view: what it owes this league, and how to pay.
create or replace function public.my_entry_fees(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'fee_id', x.id, 'team', e.display_name, 'division', e.division,
             'amount_cents', x.amount_cents, 'status', x.status, 'paid_at', x.paid_at, 'method', x.method,
             'league', o.name,
             'instructions', coalesce((select f.instructions from public.competition_fees f where f.competition_id = x.competition_id and f.division = e.division),
                                      (select f.instructions from public.competition_fees f where f.competition_id = x.competition_id and f.division = ''))
           ) order by e.division, e.display_name)
      from public.entry_fees x
      join public.competition_entries e on e.id = x.entry_id
      join public.competitions c on c.id = x.competition_id
      join public.academies o on o.id = c.organiser_id
     where x.competition_id = p_competition
       and x.club_academy_id is not null
       and app_private.is_academy_staff(x.club_academy_id)
  ), '[]'::jsonb);
$fn$;

-- ---------------------------------------------------------------------
-- Entry requests from the public page
-- ---------------------------------------------------------------------
alter table public.competitions add column if not exists entries_open boolean not null default false;

create table if not exists public.competition_entry_requests (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  club_name      text not null check (length(btrim(club_name)) > 0),
  team_name      text not null check (length(btrim(team_name)) > 0),
  division       text,
  contact_name   text not null check (length(btrim(contact_name)) > 0),
  contact_phone  text,
  contact_email  text,
  note           text,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  entry_id       uuid references public.competition_entries(id) on delete set null,
  invite_id      uuid references public.competition_invites(id) on delete set null,
  ip_hash        text,
  created_at     timestamptz not null default now()
);
alter table public.competition_entry_requests enable row level security;
create policy competition_entry_requests_select on public.competition_entry_requests for select to authenticated
  using ((select app_private.may_run(competition_entry_requests.competition_id, 'competition')));
create index if not exists competition_entry_requests_idx on public.competition_entry_requests (competition_id, status, created_at);

-- What the public form needs: name, divisions and fees. Null unless the
-- competition is published and open to entries.
create or replace function public.public_competition_entry(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
           'name', c.name,
           'season', c.season,
           'organiser', (select a.name from public.academies a where a.id = c.organiser_id),
           'divisions', coalesce((
             select jsonb_agg(jsonb_build_object('division', d.division, 'fee_cents', app_private.fee_for(c.id, d.division)) order by d.division)
               from (select distinct division from public.competition_entries where competition_id = c.id and division is not null
                     union select division from public.competition_divisions where competition_id = c.id) d
           ), '[]'::jsonb),
           'fee_cents', app_private.fee_for(c.id, null),
           'instructions', (select f.instructions from public.competition_fees f where f.competition_id = c.id and f.division = '')
         )
    from public.competitions c
   where c.public_slug = p_slug and c.published_at is not null and c.entries_open;
$fn$;

-- Called by the route with the service role, which rate-limits by IP first.
create or replace function public.request_competition_entry(
  p_slug text, p_club_name text, p_team_name text, p_division text,
  p_contact_name text, p_contact_phone text, p_contact_email text, p_note text, p_ip_hash text
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_comp uuid;
  v_recent integer;
  v_id uuid;
begin
  select id into v_comp from public.competitions
   where public_slug = p_slug and published_at is not null and entries_open;
  if v_comp is null then
    raise exception 'That competition isn''t taking entries.' using errcode = '22023';
  end if;
  select count(*) into v_recent from public.competition_entry_requests
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'Too many entries just now. Try again shortly.' using errcode = '22023';
  end if;
  if exists (select 1 from public.competition_entry_requests
              where competition_id = v_comp and status = 'pending'
                and lower(btrim(club_name)) = lower(btrim(p_club_name)) and lower(btrim(team_name)) = lower(btrim(p_team_name))) then
    raise exception 'That team has already asked to enter; the organiser will be in touch.' using errcode = '23505';
  end if;
  insert into public.competition_entry_requests (competition_id, club_name, team_name, division, contact_name, contact_phone, contact_email, note, ip_hash)
  values (v_comp, btrim(p_club_name), btrim(p_team_name), nullif(btrim(coalesce(p_division, '')), ''),
          btrim(p_contact_name), nullif(btrim(coalesce(p_contact_phone, '')), ''), nullif(btrim(coalesce(p_contact_email, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), p_ip_hash)
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.entry_requests(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not app_private.may_run(p_competition, 'competition') then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'club_name', r.club_name, 'team_name', r.team_name, 'division', r.division,
               'contact_name', r.contact_name, 'contact_phone', r.contact_phone, 'contact_email', r.contact_email,
               'note', r.note, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
               'token', (select ci.token from public.competition_invites ci where ci.id = r.invite_id and ci.status = 'pending')
             ) order by (r.status = 'pending') desc, r.created_at)
        from public.competition_entry_requests r
       where r.competition_id = p_competition
    ), '[]'::jsonb)
  end;
$fn$;

-- Accept: an entry on the draw, an invitation for the club to claim it,
-- and (by the trigger) the fee. Decline: a note, nothing else.
create or replace function public.decide_entry_request(p_request uuid, p_accept boolean, p_division text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.competition_entry_requests;
  v_division text;
  v_entry uuid;
  v_invite uuid;
  v_token text;
begin
  select * into v_req from public.competition_entry_requests where id = p_request;
  if v_req.id is null or not app_private.may_run(v_req.competition_id, 'competition') then
    raise exception 'only the organiser decides an entry' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'already %', v_req.status using errcode = '22023';
  end if;
  if not p_accept then
    update public.competition_entry_requests
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_request;
    return jsonb_build_object('status', 'declined');
  end if;
  v_division := coalesce(nullif(btrim(coalesce(p_division, '')), ''), v_req.division);
  if v_division is null then
    raise exception 'which division?' using errcode = '22023';
  end if;
  insert into public.competition_entries (competition_id, display_name, division)
  values (v_req.competition_id, v_req.team_name, v_division)
  on conflict (competition_id, division, display_name) do update set display_name = excluded.display_name
  returning id into v_entry;
  insert into public.competition_invites (competition_id, entry_id, club_name, contact_name, contact_email, contact_phone, invited_by)
  values (v_req.competition_id, v_entry, v_req.club_name, v_req.contact_name,
          case when v_req.contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_req.contact_email::citext end,
          case when v_req.contact_phone ~ '^\+[1-9][0-9]{7,14}$' then v_req.contact_phone end,
          auth.uid())
  returning id, token into v_invite, v_token;
  update public.competition_entry_requests
     set status = 'accepted', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         entry_id = v_entry, invite_id = v_invite, division = v_division
   where id = p_request;
  return jsonb_build_object('status', 'accepted', 'entry_id', v_entry, 'token', v_token);
end;
$fn$;

-- The public page says when entries are open.
create or replace function public.public_match_centre(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_comp public.competitions;
begin
  select * into v_comp
    from public.competitions
   where public_slug = p_slug
     and published_at is not null
     and public_slug is not null;
  if v_comp.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'competition', jsonb_build_object(
      'name', v_comp.name,
      'season', v_comp.season,
      'organiser', (select a.name from public.academies a where a.id = v_comp.organiser_id)
    ),
    'entries_open', v_comp.entries_open,

    'fixtures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id,
               'starts_at', f.starts_at,
               'round', f.round,
               'division', f.division,
               'group_label', f.group_label,
               'venue', coalesce(v.name, f.venue_label),
               'field', f.field_label,
               'home', home.display_name,
               'away', away.display_name,
               'home_entry_id', f.home_entry_id,
               'away_entry_id', f.away_entry_id,
               'home_score', case when r.scores_public then f.home_score end,
               'away_score', case when r.scores_public then f.away_score end,
               'scores_hidden', not r.scores_public,
               'status', f.status
             ) order by f.starts_at nulls last, f.field_label)
        from public.fixtures f
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries home on home.id = f.home_entry_id
        left join public.competition_entries away on away.id = f.away_entry_id
        cross join lateral app_private.division_rules(v_comp.id, f.division) r
       where f.competition_id = v_comp.id
    ), '[]'::jsonb),

    'ladder', coalesce((
      select jsonb_object_agg(d.division, d.table)
        from (
          select e.division,
                 coalesce((
                   select jsonb_agg(to_jsonb(l))
                     from app_private.ladder(v_comp.id, e.division) l
                 ), '[]'::jsonb) as table
            from (select distinct division from public.competition_entries
                   where competition_id = v_comp.id and division is not null) e
            cross join lateral app_private.division_rules(v_comp.id, e.division) r
           where r.ladder_enabled and r.scores_public
        ) d
    ), '{}'::jsonb),

    'top_scorers', coalesce((
      select jsonb_object_agg(d.division, app_private.public_top_scorers(v_comp.id, d.division))
        from (select distinct division from public.competition_entries
               where competition_id = v_comp.id and division is not null) d
        cross join lateral app_private.division_rules(v_comp.id, d.division) r
       where r.scores_public
    ), '{}'::jsonb),

    'divisions', coalesce((
      select jsonb_agg(distinct e.division order by e.division)
        from public.competition_entries e
       where e.competition_id = v_comp.id and e.division is not null
    ), '[]'::jsonb),

    'squads', coalesce((
      select jsonb_object_agg(s.entry_id, s.players)
        from (
          select e.id as entry_id,
                 jsonb_agg(
                   jsonb_build_object('name', pub.name, 'number', pub.number)
                   order by pub.number nulls last, pub.name
                 ) as players
            from public.competition_entries e
            join lateral (
              select app_private.public_player_name(
                       pl.full_name, pl.preferred_name,
                       a.public_player_names, pl.public_name_hidden
                     ) as name,
                     (select sn.number
                        from public.squad_numbers sn
                       where sn.player_id = pl.id
                         and sn.season = coalesce(v_comp.season, sn.season)
                       limit 1) as number
                from public.players pl
                join public.academies a on a.id = pl.academy_id
               where pl.team_id = e.team_id
                 and pl.academy_id = e.academy_id
            ) pub on pub.name is not null
           where e.competition_id = v_comp.id
             and e.team_id is not null
           group by e.id
        ) s
    ), '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.public_match_centre(text) from public;
grant execute on function public.public_match_centre(text) to anon, authenticated;
revoke all on function public.public_competition_entry(text) from public;
grant execute on function public.public_competition_entry(text) to anon, authenticated;
revoke all on function public.request_competition_entry(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.request_competition_entry(text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.set_competition_fee(uuid, text, integer, text) to authenticated;
grant execute on function public.mark_entry_fee(uuid, public.entry_fee_status, text, text) to authenticated;
grant execute on function public.competition_fees_view(uuid) to authenticated;
grant execute on function public.my_entry_fees(uuid) to authenticated;
grant execute on function public.entry_requests(uuid) to authenticated;
grant execute on function public.decide_entry_request(uuid, boolean, text, text) to authenticated;

-- Find a club (the registration brief, gap 5): a public page, /clubs, where
-- a family searches by club name or suburb and each club card leads to its
-- open programs; and a league's public page lists the clubs in it.
--
-- Two more doors for a stranger, each on 0185's allow-list with its reason.
-- Both answer with clubs and programs only — never a person, a number or an
-- address beyond the suburb the club chose to give. A club is listed while
-- it has something open to register for and its Find a club switch is on;
-- a league is never a club.

alter table public.academies
  add column if not exists suburb text;

create or replace function public.public_find_clubs(p_query text default null)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  with q as (select nullif(btrim(coalesce(p_query, '')), '') as term),
  open_programs as (
    select p.academy_id, p.id, p.name, p.kind, p.season, p.born_from_year, p.born_to_year, p.closes_at, p.starts_on
      from public.programs p
     where p.status = 'open'
       and (p.opens_at is null or p.opens_at <= now())
       and (p.closes_at is null or p.closes_at > now())
  ),
  clubs as (
    select a.id, a.name, a.slug, a.suburb, a.logo_url, a.primary_colour, a.type
      from public.academies a
     where a.type <> 'league'
       and a.slug is not null
       and exists (select 1 from open_programs op where op.academy_id = a.id)
       and app_private.feature_on(a.id, 'find_a_club')
       and ((select term from q) is null
            or a.name ilike '%' || (select term from q) || '%'
            or coalesce(a.suburb, '') ilike '%' || (select term from q) || '%')
     order by a.name
     limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', c.name,
           'slug', c.slug,
           'suburb', c.suburb,
           'logo_url', c.logo_url,
           'primary_colour', c.primary_colour,
           'type', c.type,
           'programs', (
             select jsonb_agg(jsonb_build_object(
                      'id', op.id,
                      'name', op.name,
                      'kind', op.kind,
                      'season', op.season,
                      'born_from_year', op.born_from_year,
                      'born_to_year', op.born_to_year,
                      'closes_at', op.closes_at
                    ) order by op.starts_on nulls last, op.name)
               from open_programs op where op.academy_id = c.id
           )
         ) order by c.name), '[]'::jsonb)
    from clubs c;
$fn$;
revoke all on function public.public_find_clubs(text) from public;
grant execute on function public.public_find_clubs(text) to anon, authenticated;

-- The clubs in a published competition: a name, a crest and the door to
-- each club's own public page. Only clubs on Squadroom; a name on the draw
-- with no club behind it is not listed.
create or replace function public.public_competition_clubs(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', a.name,
             'slug', a.slug,
             'suburb', a.suburb,
             'logo_url', a.logo_url
           ) order by a.name)
      from public.competitions c
      join public.competition_clubs cc on cc.competition_id = c.id and cc.status = 'active'
      join public.academies a on a.id = cc.academy_id
     where c.public_slug = p_slug
       and c.published_at is not null
       and a.type <> 'league'
  ), '[]'::jsonb);
$fn$;
revoke all on function public.public_competition_clubs(text) from public;
grant execute on function public.public_competition_clubs(text) to anon, authenticated;

insert into app_private.anon_callable (proname, why) values
  ('public_find_clubs', 'Find a club: clubs with something open to register for, by name or suburb, with their open programs — never a person'),
  ('public_competition_clubs', 'a published competition''s clubs — a name, a crest and the door to each club''s own public page')
on conflict (proname) do update set why = excluded.why;

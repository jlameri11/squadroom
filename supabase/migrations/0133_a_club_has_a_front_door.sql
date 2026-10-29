-- 0133: a club has a front door.
--
-- G-02. `/{slug}` 404'd. Everything the page needed — name, crest, colour,
-- the open programs with price, birth years and places left — was already
-- published by `public_programs` (0122) and rendered one level down inside
-- the register FORM, so a parent who typed the club's address into a browser
-- found nothing, and a club with a website had nowhere to link that was not
-- a form asking for a child's date of birth.
--
-- This is the function the front door reads. It is `public_programs` plus
-- one thing the form never needed: the competitions this club plays in
-- that have a public match centre, so the page can link to the draw.
--
-- IT CALLS public_programs RATHER THAN COPYING IT. Two functions describing
-- a program's price and places left are two answers to "how much and is it
-- full", and test-public-registration asserts the first one byte for byte.
-- The one subtraction is `consents`: the landing page asks nobody to agree
-- to anything, and a page cached for a hundred readers should not carry
-- four documents' full text.
--
-- A COMPETITION IS LISTED BY THE SAME RULE THAT MAKES ITS PAGE EXIST:
-- `public_slug` and `published_at` both set (0096). Nothing here widens what
-- `public_match_centre` shows; it only says where it is. Being an entered
-- club counts once the club has JOINED, not when it has been invited — an
-- invitation is the organiser's intention, not the club's.
--
-- FIRST FUNCTION CREATED UNDER 0132's CLOSED DEFAULT. Without the explicit
-- grant below, anon could not call it and the page would be blank — which
-- is the failure mode that default was chosen for: loud, in the function's
-- own test, rather than silent to a stranger.
--
-- Publishes nothing new about a person: no child, no family, no phone, no
-- member. Asserted by test-public-academy.

create or replace function public.public_academy(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_base    jsonb;
  v_academy uuid;
begin
  v_base := public.public_programs(p_slug);
  if v_base is null then
    return null;
  end if;

  select id into v_academy from public.academies where slug = lower(btrim(p_slug));

  return (v_base - 'consents') || jsonb_build_object(
    'competitions', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'slug',      c.public_slug,
                 'name',      c.name,
                 'season',    c.season,
                 'organiser', (select a.name from public.academies a where a.id = c.organiser_id),
                 'starts_on', c.starts_on,
                 'ends_on',   c.ends_on
               )
               order by c.starts_on desc nulls last, c.name
             )
        from public.competitions c
       where c.public_slug is not null
         and c.published_at is not null
         and (
           c.organiser_id = v_academy
           or exists (
             select 1
               from public.competition_clubs cc
              where cc.competition_id = c.id
                and cc.academy_id = v_academy
                and cc.joined_at is not null
           )
         )
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.public_academy(text) from public;
grant execute on function public.public_academy(text) to anon, authenticated;

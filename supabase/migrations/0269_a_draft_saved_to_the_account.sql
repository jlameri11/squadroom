-- Save and resume (the registration brief, gap 8): a half-filled
-- registration saved beyond the browser — to the account where the person
-- is signed in, and by a resume code where they are not — so it can be
-- finished on another phone. A draft holds names, a date of birth, a
-- mobile and an email: a person's own rows are theirs alone, and a code's
-- draft is reached only through the route that holds the service role.
-- Drafts keep for fourteen days.

create table if not exists public.registration_drafts (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  -- One or the other: a signed-in person's draft, or a code's.
  profile_id  uuid references public.profiles(id) on delete cascade,
  code        text unique,
  draft       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  constraint registration_drafts_keyed check ((profile_id is null) <> (code is null)),
  -- One draft per person per club (nulls distinct: code drafts never collide).
  constraint registration_drafts_one_per_person unique (academy_id, profile_id)
);
alter table public.registration_drafts enable row level security;

drop policy if exists registration_drafts_own on public.registration_drafts;
create policy registration_drafts_own on public.registration_drafts
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()) and code is null);
grant select, insert, update, delete on public.registration_drafts to authenticated;
-- A stranger's draft is reached through the route alone, never the table.
revoke all on public.registration_drafts from anon;

-- The public page carries the club's id, which the form needs to keep a
-- signed-in person's draft against the club.
create or replace function public.public_programs(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy public.academies;
begin
  select * into v_academy from public.academies where slug = lower(btrim(p_slug));
  if v_academy.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', jsonb_build_object(
      'id', v_academy.id,
      'name', v_academy.name,
      'slug', v_academy.slug,
      'primary_colour', v_academy.primary_colour,
      'logo_url', v_academy.logo_url,
      'timezone', v_academy.timezone,
      'photo_required', v_academy.photo_required,
      'active_kids', app_private.takes_active_kids(v_academy.id)
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'kind', p.kind,
               'description', p.description,
               'season', p.season,
               'born_from_year', p.born_from_year,
               'born_to_year', p.born_to_year,
               'gender', p.gender,
               'starts_on', p.starts_on,
               'ends_on', p.ends_on,
               'closes_at', p.closes_at,
               'questions', p.questions,
               'payment_required', p.payment_required,
               'pay_timing', p.pay_timing,
               'amount_cents', (
                 select pr.amount_cents from public.payment_requests pr
                  where pr.id = p.payment_request_id
               ),
               'spots_left', app_private.program_spots_left(p.id),
               'waitlist_enabled', p.waitlist_enabled,
               'requires_official_rego', p.requires_official_rego
             ) order by p.starts_on nulls last, p.name)
        from public.programs p
       where p.academy_id = v_academy.id
         and p.status = 'open'
         and (p.opens_at is null or p.opens_at <= now())
         and (p.closes_at is null or p.closes_at > now())
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'title', c.title,
               'version', c.version,
               'body', c.body,
               'required', c.required
             ) order by c.required desc, c.title)
        from public.consent_documents c
       where c.academy_id = v_academy.id
         and c.published_at is not null
         and c.retired_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;

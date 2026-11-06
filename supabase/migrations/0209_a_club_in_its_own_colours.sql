-- 0209: a club in its own colours, and a person in their own appearance.
--
-- Joey, 4 Nov 2026 ("Club & league branding + parent themes"). Two columns,
-- two more, and one public function. No policy changes, because the policies
-- that guard these rows already say the right thing — and test-rls checks
-- 112 and 113 prove it by trying, rather than this file claiming it:
--
--   academies.secondary_colour — the club's second colour: highlights in the
--     app (the active tab) and an accent on its share cards. Written through
--     academies_update, which is the club's owner and admins only
--     (app_private.is_academy_staff); a coach and a family are refused. Same
--     for an academy, a club and a league — they are all `academies`.
--
--   profiles.appearance, profiles.colour_mode — how the app looks for ONE
--     person: their club's colours or Squadroom's black and white; light,
--     dark, or matching the phone. Written through profiles_update, which is
--     the person's own row and nobody else's. Read back only by that person's
--     own browser (components/theme-controller.tsx); it changes nothing for
--     anybody else.
--
--   public.public_brand(p_slug, p_kind) — the name, colours and logo behind
--     a public page: a club's front door (kind 'club', by its slug) or a
--     published competition's match centre (kind 'competition', its
--     organiser). Only what those pages already show — no person, no member,
--     nothing private — and for a competition only under the rule that makes
--     its page exist at all (public_slug and published_at, 0096).
--
-- Applied when the Supabase access token is back (NEEDS JOEY #12). Until
-- then the app works without it: the second colour is not saved, the
-- appearance lives on the phone, and public pages use the first colour.

alter table public.academies
  add column if not exists secondary_colour text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'academies_secondary_colour_hex') then
    alter table public.academies
      add constraint academies_secondary_colour_hex
      check (secondary_colour is null or secondary_colour ~* '^#[0-9a-f]{6}$');
  end if;
end $$;

comment on column public.academies.secondary_colour is
  'The club''s second colour (#rrggbb): app highlights and share-card accents. Owner/admin only, through academies_update.';

alter table public.profiles
  add column if not exists appearance  text not null default 'club',
  add column if not exists colour_mode text not null default 'system';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_appearance_known') then
    alter table public.profiles
      add constraint profiles_appearance_known check (appearance in ('club', 'mono'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_colour_mode_known') then
    alter table public.profiles
      add constraint profiles_colour_mode_known check (colour_mode in ('system', 'light', 'dark'));
  end if;
end $$;

comment on column public.profiles.appearance is
  'Settings → Appearance: club = the club''s colours, mono = Squadroom''s black and white. This person''s own; changes nothing for anyone else.';
comment on column public.profiles.colour_mode is
  'Settings → Appearance: system (match the phone), light or dark.';

create or replace function public.public_brand(p_slug text, p_kind text default 'club')
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when p_kind = 'club' then (
      select jsonb_build_object(
               'name',      a.name,
               'primary',   a.primary_colour,
               'secondary', a.secondary_colour,
               'logo',      a.logo_url)
        from public.academies a
       where a.slug = lower(btrim(p_slug)))
    when p_kind = 'competition' then (
      select jsonb_build_object(
               'name',      a.name,
               'primary',   a.primary_colour,
               'secondary', a.secondary_colour,
               'logo',      a.logo_url)
        from public.competitions c
        join public.academies a on a.id = c.organiser_id
       where c.public_slug = lower(btrim(p_slug))
         and c.published_at is not null
       limit 1)
  end;
$fn$;

-- A person reads their own Appearance from the profile. profiles is read by
-- column grant (0012 withheld phone from everyone), so the two new columns
-- need theirs, or asking for them is refused (found 6 Nov 2026: the theme
-- asked for `*` and was refused on every page). Club-mates can read them
-- too, as with every granted profile column; a theme choice is not private.
grant select (appearance, colour_mode) on public.profiles to authenticated;

revoke execute on function public.public_brand(text, text) from public;
grant execute on function public.public_brand(text, text) to anon, authenticated;

-- 0185's allow-list: test-rls 92 fails the day an anon-callable function is
-- not on it, with a reason.
insert into app_private.anon_callable (proname, why) values
  ('public_brand', 'the colours and logo on a club''s front door and a public match centre')
on conflict (proname) do update set why = excluded.why;

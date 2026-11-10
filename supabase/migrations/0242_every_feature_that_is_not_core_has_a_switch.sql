-- 0242: every feature that is not core has a switch.
--
-- Joey, 10 Nov 2026 (docs/SIMPLICITY.md): "Every feature that isn't core
-- gets an on/off switch in Settings → Features (club or league level), with
-- a one-line description. Built and tested, but easy to hide later. When a
-- switch is off, nothing about that feature appears anywhere. For now,
-- leave them all ON in the demo."
--
-- One row per switched-OFF feature (absent = on), so a feature built
-- tomorrow is on everywhere until somebody turns it off, and the demo stays
-- as it is. The catalogue — the keys, their names and one-line descriptions
-- — lives in the app (lib/features.ts) beside the screens it hides; the
-- database only knows which keys an organisation has turned off, and
-- `app_private.feature_on` is how a function behind a switch asks.

create table if not exists public.academy_features (
  academy_id uuid not null references public.academies(id) on delete cascade,
  feature    text not null check (feature ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled    boolean not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (academy_id, feature)
);
alter table public.academy_features enable row level security;
grant select on public.academy_features to authenticated;
drop policy if exists academy_features_select on public.academy_features;
create policy academy_features_select on public.academy_features for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
-- Written only by set_feature.

create or replace function app_private.feature_on(p_academy uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select not exists (
    select 1 from public.academy_features f
     where f.academy_id = p_academy and f.feature = p_feature and f.enabled = false);
$fn$;
grant execute on function app_private.feature_on(uuid, text) to authenticated;

-- The switch: owners, admins, the President and the Secretary (a league's
-- staff for a league). Turning a feature back on removes the row.
create or replace function public.set_feature(p_academy uuid, p_feature text, p_enabled boolean)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not app_private.may_run_club(p_academy, 'club') then
    raise exception 'only the people who run the organisation switch its features' using errcode = '42501';
  end if;
  if p_feature !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'no such feature' using errcode = '22023';
  end if;
  if p_enabled then
    delete from public.academy_features where academy_id = p_academy and feature = p_feature;
  else
    insert into public.academy_features (academy_id, feature, enabled, changed_by)
    values (p_academy, p_feature, false, auth.uid())
    on conflict (academy_id, feature) do update set enabled = false, changed_by = auth.uid(), changed_at = now();
  end if;
  perform app_private.log_activity(p_academy, case when p_enabled then 'feature.on' else 'feature.off' end, 'feature', null, p_feature, '{}'::jsonb);
  return p_enabled;
end;
$fn$;
revoke execute on function public.set_feature(uuid, text, boolean) from public, anon;
grant execute on function public.set_feature(uuid, text, boolean) to authenticated;

-- What is off here — the screens ask once per organisation.
create or replace function public.features_off(p_academy uuid)
returns text[]
language sql stable security definer set search_path = public as $fn$
  select case when app_private.is_academy_member(p_academy)
              then coalesce((select array_agg(f.feature order by f.feature) from public.academy_features f where f.academy_id = p_academy and not f.enabled), '{}')
              else '{}' end;
$fn$;
revoke execute on function public.features_off(uuid) from public, anon;
grant execute on function public.features_off(uuid) to authenticated;

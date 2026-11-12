-- The Active & Creative Kids voucher (the registration brief, gap 3; NSW,
-- $50, two a year per child). A club that is a registered provider takes
-- one at checkout: the family types the voucher number and the child's
-- details as they are on the voucher, $50 comes off the fee, and the
-- Treasurer gets the list to redeem in the Service NSW provider portal,
-- with a tick when it is done. Squadroom never contacts Service NSW: it
-- keeps the number, and the money is the club's to claim.
--
-- Built on 0193's vouchers: the family's voucher is a `vouchers` row of kind
-- `government`, worth $50, used once, carrying the number and the child's
-- details, with one redemption on the fee — so the quote, who-owes, the
-- reminders and the checkout take it off the way they take any voucher off.

alter table public.academies
  add column if not exists active_kids_provider boolean not null default false;

alter table public.vouchers
  add column if not exists voucher_number text,
  add column if not exists child_name text,
  add column if not exists child_dob date,
  add column if not exists entered_by uuid references public.profiles(id) on delete set null,
  add column if not exists redeemed_at timestamptz,
  add column if not exists redeemed_by uuid references public.profiles(id) on delete set null,
  -- A voucher used on a pay-now registration (0262) before the club has
  -- decided: a decline or a lapse gives it back (the trigger below).
  add column if not exists registration_request_id uuid references public.registration_requests(id) on delete set null;

-- A voucher is one child's, and is used once, anywhere.
create unique index if not exists vouchers_number_once on public.vouchers (voucher_number) where voucher_number is not null;
create index if not exists vouchers_registration_request on public.vouchers (registration_request_id) where registration_request_id is not null;

-- The number as it is on the voucher, without spaces or dashes; null when it
-- is not a number at all. Service NSW prints sixteen digits; the shape is
-- kept loose on purpose so a real voucher is never refused for its format.
create or replace function app_private.active_kids_number(p_raw text)
returns text language sql immutable as $fn$
  select case when length(t.n) between 10 and 24 then t.n end
    from (select upper(regexp_replace(coalesce(p_raw, ''), '[^A-Za-z0-9]', '', 'g'))) t(n);
$fn$;

-- The club takes vouchers: a registered provider, with the feature on.
create or replace function app_private.takes_active_kids(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select a.active_kids_provider from public.academies a where a.id = p_academy), false)
     and app_private.feature_on(p_academy, 'active_kids');
$fn$;
grant execute on function app_private.takes_active_kids(uuid) to authenticated;

-- The family puts a voucher on a child's fee. The child's family (or the
-- club's staff and its Treasurer, for a family at the desk); the club a
-- provider with the feature on; the number unused anywhere; one voucher per
-- fee (0193's rule); $50 off, or what is left of the fee if that is less.
create or replace function public.apply_active_kids_voucher(p_request uuid, p_player uuid, p_number text, p_child_name text, p_child_dob date)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_req    public.payment_requests;
  v_number text := app_private.active_kids_number(p_number);
  v_name   text := btrim(coalesce(p_child_name, ''));
  v_family boolean := coalesce(app_private.is_guardian_of(p_player), false);
  v_base   integer;
  v_paid   integer;
  v_off    integer;
  v_id     uuid;
begin
  select * into v_req from public.payment_requests where id = p_request;
  if v_req.id is null then
    raise exception 'no such fee' using errcode = '22023';
  end if;
  if not (v_family
          or coalesce(app_private.is_academy_staff(v_req.academy_id), false)
          or coalesce(app_private.may_run_club(v_req.academy_id, 'money'), false)) then
    raise exception 'only the child''s family uses a voucher on their fee' using errcode = '42501';
  end if;
  if not app_private.takes_active_kids(v_req.academy_id) then
    raise exception 'this club does not take Active & Creative Kids vouchers' using errcode = '22023';
  end if;
  if v_number is null then
    raise exception 'that does not look like a voucher number' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'the child''s name, as it is on the voucher' using errcode = '22023';
  end if;
  if p_child_dob is null or p_child_dob > current_date then
    raise exception 'the child''s date of birth, as it is on the voucher' using errcode = '22023';
  end if;
  if exists (select 1 from public.vouchers v where v.voucher_number = v_number) then
    raise exception 'that voucher has already been used' using errcode = '23505';
  end if;
  if exists (select 1 from public.voucher_redemptions r where r.request_id = p_request and r.player_id is not distinct from p_player) then
    raise exception 'a voucher is already on this fee' using errcode = '23505';
  end if;
  v_base := app_private.fee_base_cents(p_request, p_player, case when v_family then auth.uid() end);
  select coalesce(sum(p.amount_cents), 0) into v_paid from public.payments p
   where p.request_id = p_request and p.player_id is not distinct from p_player and p.status in ('paid', 'processing');
  if v_base - v_paid <= 0 then
    raise exception 'this fee is already paid' using errcode = '22023';
  end if;
  v_off := least(5000, v_base - v_paid);
  insert into public.vouchers (academy_id, code, label, kind, amount_cents, max_uses, used_count, voucher_number, child_name, child_dob, entered_by, created_by)
  values (v_req.academy_id, 'AK-' || v_number, 'Active & Creative Kids', 'government', 5000, 1, 1, v_number, v_name, p_child_dob, auth.uid(), auth.uid())
  returning id into v_id;
  insert into public.voucher_redemptions (academy_id, voucher_id, request_id, player_id, profile_id, amount_cents)
  values (v_req.academy_id, v_id, p_request, p_player, auth.uid(), v_off);
  return jsonb_build_object('voucher', 'Active & Creative Kids', 'kind', 'government', 'off_cents', v_off, 'left_cents', v_base - v_paid - v_off, 'number', v_number);
end;
$fn$;
revoke execute on function public.apply_active_kids_voucher(uuid, uuid, text, text, date) from public, anon;
grant execute on function public.apply_active_kids_voucher(uuid, uuid, text, text, date) to authenticated;

-- The Treasurer's list: every voucher the club holds, to redeem in the
-- Service NSW portal, the unredeemed first. One on a registration the club
-- has not decided yet is `waiting` — not to be redeemed, since a decline
-- gives it back to the family.
create or replace function public.active_kids_to_redeem(p_academy uuid)
returns table (
  voucher_id     uuid,
  voucher_number text,
  child_name     text,
  child_dob      date,
  family         text,
  fee_title      text,
  off_cents      integer,
  entered_at     timestamptz,
  redeemed_at    timestamptz,
  redeemed_by    text,
  waiting        boolean
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not (coalesce(app_private.is_academy_staff(p_academy), false)
          or coalesce(app_private.may_run_club(p_academy, 'money'), false)) then
    raise exception 'only the club''s staff and its Treasurer see the vouchers to redeem' using errcode = '42501';
  end if;
  return query
  select v.id, v.voucher_number, v.child_name, v.child_dob,
         (select pr.full_name from public.profiles pr where pr.id = v.entered_by),
         (select r.title from public.voucher_redemptions vr join public.payment_requests r on r.id = vr.request_id where vr.voucher_id = v.id limit 1),
         (select vr.amount_cents from public.voucher_redemptions vr where vr.voucher_id = v.id limit 1),
         v.created_at, v.redeemed_at,
         (select pr.full_name from public.profiles pr where pr.id = v.redeemed_by),
         exists (select 1 from public.registration_requests q where q.id = v.registration_request_id and q.status = 'pending')
    from public.vouchers v
   where v.academy_id = p_academy and v.voucher_number is not null
   order by v.redeemed_at nulls first, v.created_at;
end;
$fn$;
revoke execute on function public.active_kids_to_redeem(uuid) from public, anon;
grant execute on function public.active_kids_to_redeem(uuid) to authenticated;

create or replace function public.mark_active_kids_redeemed(p_voucher uuid, p_redeemed boolean)
returns void language plpgsql volatile security definer set search_path = public as $fn$
declare
  v public.vouchers;
begin
  select * into v from public.vouchers where id = p_voucher and voucher_number is not null;
  if v.id is null then
    raise exception 'no such voucher' using errcode = '22023';
  end if;
  if not (coalesce(app_private.is_academy_staff(v.academy_id), false)
          or coalesce(app_private.may_run_club(v.academy_id, 'money'), false)) then
    raise exception 'only the club''s staff and its Treasurer mark a voucher redeemed' using errcode = '42501';
  end if;
  if p_redeemed and exists (select 1 from public.registration_requests q where q.id = v.registration_request_id and q.status = 'pending') then
    raise exception 'wait until the club has decided this registration — a declined family gets their voucher back' using errcode = '22023';
  end if;
  update public.vouchers
     set redeemed_at = case when p_redeemed then now() end,
         redeemed_by = case when p_redeemed then auth.uid() end
   where id = v.id;
end;
$fn$;
revoke execute on function public.mark_active_kids_redeemed(uuid, boolean) from public, anon;
grant execute on function public.mark_active_kids_redeemed(uuid, boolean) to authenticated;

-- A registration the club declines, or that lapses, gives the family's
-- voucher back: the row goes (its redemption with it), the number is free.
create or replace function app_private.active_kids_voucher_back()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.status = 'pending' and new.status in ('declined', 'expired') then
    delete from public.vouchers v
     where v.registration_request_id = new.id and v.voucher_number is not null and v.redeemed_at is null;
  end if;
  return new;
end;
$fn$;
drop trigger if exists on_registration_voucher_back on public.registration_requests;
create trigger on_registration_voucher_back
  after update of status on public.registration_requests
  for each row execute function app_private.active_kids_voucher_back();

-- The public page says whether the club takes the voucher (pay-now
-- registrations enter it before paying).
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

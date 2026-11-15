-- 0280 — the Treasurer sees what the club owes the league (Season 4
-- simulation, seed 2, OFF4). `my_entry_fees` and `my_levy_statement` asked
-- for club STAFF; a Treasurer holds a committee seat (club_roles), not a
-- hat, and so saw nothing of the entry fees or the levy — the one person
-- who pays them. The money area (`may_run_club(…, 'money')`) reads them
-- too, as it does the club's own fees.
create or replace function public.my_entry_fees(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
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
       and (app_private.is_academy_staff(x.club_academy_id) or app_private.may_run_club(x.club_academy_id, 'money'))
  ), '[]'::jsonb);
$$;

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'my_levy_statement';
  if v_src is null then return; end if;
  if position('coalesce(app_private.is_academy_staff(cc.academy_id), false)' in v_src) = 0 then
    raise exception 'my_levy_statement does not look as 0280 expects; edit it by hand';
  end if;
  execute replace(v_src,
    'coalesce(app_private.is_academy_staff(cc.academy_id), false)',
    '(coalesce(app_private.is_academy_staff(cc.academy_id), false) or app_private.may_run_club(cc.academy_id, ''money''))');
end $$;

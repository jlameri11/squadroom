-- 0155: a report without min() of a uuid.
--
-- 0153's discipline_report picked "an entry for this player" with
-- min(entry_id). Postgres has no min for uuid; the report raised
-- "function min(uuid) does not exist" the first time anybody asked for it.
-- The first entry from array_agg does the same job. Nothing else changes.

create or replace function public.discipline_report(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_competition_participant(p_competition), false) then
    raise exception 'not yours to see' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rules', (select to_jsonb(r) from app_private.discipline_rules(p_competition) r),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', x.player_id,
               'name',      (select pl.full_name from public.players pl where pl.id = x.player_id),
               'club',      (select a.name from public.players pl join public.academies a on a.id = pl.academy_id where pl.id = x.player_id),
               'entry',     (select e.display_name from public.competition_entries e where e.id = x.entry_id),
               'yellows',   x.yellows, 'reds', x.reds, 'blues', x.blues,
               'suspensions', coalesce((
                 select jsonb_agg(jsonb_build_object('id', s.id, 'reason', s.reason, 'games', s.games, 'served', s.served,
                          'status', s.status, 'issued_at', s.issued_at, 'note', s.note, 'appeal_note', s.appeal_note)
                          order by s.issued_at desc)
                   from public.suspensions s where s.competition_id = p_competition and s.player_id = x.player_id), '[]'::jsonb)
             ) order by x.reds desc, x.yellows desc, x.player_id)
        from (
          select e.player_id, (array_agg(e.entry_id))[1] as entry_id,
                 count(*) filter (where e.kind = 'yellow')::integer as yellows,
                 count(*) filter (where e.kind = 'red')::integer as reds,
                 count(*) filter (where e.kind = 'blue')::integer as blues
            from public.match_events e
           where e.competition_id = p_competition and e.player_id is not null and e.kind in ('yellow', 'red', 'blue')
           group by e.player_id
          union
          select s.player_id, (array_agg(s.entry_id))[1], 0, 0, 0
            from public.suspensions s
           where s.competition_id = p_competition
             and not exists (select 1 from public.match_events e where e.competition_id = p_competition and e.player_id = s.player_id and e.kind in ('yellow','red','blue'))
           group by s.player_id
        ) x
    ), '[]'::jsonb)
  );
end;
$fn$;

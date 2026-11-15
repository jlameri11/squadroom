-- 0277 — the league's Home on a Sunday (Season 4 simulation, bug #19).
--
-- The league's Home says "N games this weekend" from today to the coming
-- Sunday. On a Sunday that window was today alone, so an organiser opening
-- the app on Sunday evening — the night the appointments go out — read
-- "Nothing this weekend" with a full Saturday drawn. A Sunday looks to the
-- weekend ahead (today's games are still in it: the window runs to the
-- following Sunday).
create or replace function app_private.weekend_end(p_day date)
returns date
language sql immutable as $$
  select case when extract(dow from p_day) = 0 then p_day + 7
              else p_day + ((7 - extract(dow from p_day)::integer) % 7) end;
$$;

-- home_jobs computes v_sun inline; the one line changes.
do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'home_jobs';
  if v_src is null or position('v_sun := v_day + ((7 - extract(dow from v_day)::integer) % 7);' in v_src) = 0 then
    raise exception 'home_jobs does not look as 0277 expects; edit it by hand';
  end if;
  v_src := replace(v_src,
    'v_sun := v_day + ((7 - extract(dow from v_day)::integer) % 7);',
    'v_sun := app_private.weekend_end(v_day);');
  execute v_src;
end $$;

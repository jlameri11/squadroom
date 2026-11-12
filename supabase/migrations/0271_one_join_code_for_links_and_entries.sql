-- 0271 — One join-code generator again, for both pools.
--
-- Found by the full run on 12 Nov 2026: seven suites (adult-player,
-- claim-child, first-run, join-codes, join-flow, role-requests, required-email,
-- self-onboarding) refused with "permission denied for function new_join_code".
--
-- join_links.code has used app_private.new_join_code() as its column DEFAULT
-- since 0089, and a column default runs as whoever inserts the row — a coach.
-- 0261 (Team Creator) then wrote a second generator under the SAME name for
-- competition_entries.join_code: it checked only that table, used an alphabet
-- join_links_code_shape refuses (L and U), dropped SECURITY DEFINER, and revoked
-- EXECUTE from authenticated. Every coach making a join link since has been
-- refused, and a code that did come out could have violated the shape check.
--
-- One function, the 0089 alphabet, free in BOTH pools (a parent typing six
-- letters has not said which kind of code they mean), definer (uniqueness is
-- checked against every row, not the rows the inserting coach may read), and
-- callable by authenticated so the column default works. It returns a random
-- free code and reads nothing else; app_private is not exposed over PostgREST.
create or replace function app_private.new_join_code()
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  -- No O/0, no I/1/L, no U — what join_links_code_shape (0089) checks.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_code     text;
  v_tries    integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;

    exit when not exists (select 1 from public.join_links l where l.code = v_code)
         and not exists (select 1 from public.competition_entries e where e.join_code = v_code);

    v_tries := v_tries + 1;
    -- At 729 million codes this cannot realistically happen; if it does,
    -- something is wrong and silently returning a duplicate would be worse.
    if v_tries > 50 then
      raise exception 'could not find a free join code after % tries', v_tries;
    end if;
  end loop;

  return v_code;
end;
$fn$;

revoke all on function app_private.new_join_code() from public, anon;
grant execute on function app_private.new_join_code() to authenticated, service_role;

comment on function app_private.new_join_code() is
  'A six-letter code free in both join_links.code and competition_entries.join_code. The default for join_links.code (0089), so authenticated may call it; 0261 had replaced it and locked it, which refused every coach''s join link until 0271.';

-- 0259: the registrations as a spreadsheet, answers and all
--
-- Part C (Joey, 10 Nov 2026), item 5: a registrations-only CSV with the
-- answers. One row per registration request — the child, the guardian, the
-- program, where it stands, PlayFootball's ids, the squad the child landed
-- on — with the answers to the program's questions, keyed as the program
-- asked them, and the program's questions alongside so the sheet can head
-- a column per question. The route (app/api/export/registrations) turns it
-- into the file; this is the data, for the club's staff and its Registrar.

create or replace function public.registrations_export(p_academy uuid, p_program uuid default null)
returns table (
  request_id            uuid,
  program_id            uuid,
  program_name          text,
  season                text,
  status                text,
  created_at            timestamptz,
  decided_at            timestamptz,
  decision_note         text,
  child_name            text,
  child_dob             date,
  child_gender          text,
  for_self              boolean,
  guardian_name         text,
  guardian_phone        text,
  guardian_email        text,
  ffa_number            text,
  fifa_id               text,
  official_confirmed_at timestamptz,
  player_id             uuid,
  team_name             text,
  answers               jsonb,
  consents              jsonb,
  questions             jsonb
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null
     or not (coalesce(app_private.is_academy_staff(p_academy), false) or app_private.may_run_club(p_academy, 'registrations')) then
    raise exception 'only the club''s staff and its Registrar export its registrations' using errcode = '42501';
  end if;
  return query
    select r.id, r.program_id, p.name, p.season, r.status, r.created_at, r.decided_at, r.decision_note,
           r.child_name, r.child_dob, r.child_gender, r.for_self,
           r.guardian_name, r.guardian_phone, r.guardian_email,
           r.ffa_number, r.fifa_id, r.official_confirmed_at,
           r.player_id, t.name,
           r.answers, r.consents, coalesce(p.questions, '[]'::jsonb)
      from public.registration_requests r
      join public.programs p on p.id = r.program_id
      left join public.players pl on pl.id = r.player_id
      left join public.teams t on t.id = pl.team_id
     where r.academy_id = p_academy
       and (p_program is null or r.program_id = p_program)
     order by p.name, r.created_at;
end;
$fn$;
revoke execute on function public.registrations_export(uuid, uuid) from public, anon;
grant execute on function public.registrations_export(uuid, uuid) to authenticated;

-- 0118: X-05, the Result half. What happened on Saturday.
--
-- `fixtures` have carried `home_score` / `away_score` since 0023, and the
-- ladder is computed from them. But a fixture is a row in a competition WE
-- run. The games a club actually plays most weekends arrive through the Dribl
-- import as ordinary `events`, and there has been nowhere to put the score —
-- so the single most asked question in a team chat on a Sunday morning has no
-- answer in the product.
--
-- ONE SCORE, ONE PLACE. An event mirrored from a fixture already has a score,
-- on the fixture, where the ladder reads it. Writing a second one onto the
-- event would give the same game two results, and the one families read would
-- not be the one the table was built from. So the columns go on `events` and
-- the writer REFUSES an event that has a fixture, pointing at the fixture
-- instead. The reader resolves it: a fixture's score if there is one, the
-- event's own otherwise.
--
-- OURS AND THEIRS, not home and away. An event knows `opponent`; it does not
-- reliably know which side was at home, because the Dribl export may not say
-- and a coach typing a friendly certainly will not. Inventing a home/away to
-- fit a familiar column shape would mean printing "0-3" for a game we won
-- 3-0. `was_home` exists separately and is allowed to be unknown, which is
-- the truth.

alter table public.events
  add column if not exists our_score        integer,
  add column if not exists their_score      integer,
  add column if not exists was_home         boolean,
  add column if not exists result_note      text,
  add column if not exists score_entered_by uuid references public.profiles(id),
  add column if not exists score_entered_at timestamptz;

-- Both or neither. A half-entered score renders as "3-" in a chat card and
-- reads as a game still in progress three days later.
alter table public.events
  drop constraint if exists events_score_is_a_pair;
alter table public.events
  add constraint events_score_is_a_pair
  check ((our_score is null) = (their_score is null));

-- Nobody loses 40-0, and a negative score is a typo with a minus key. Wide
-- enough for a real junior scoreline, narrow enough to catch a mis-key.
alter table public.events
  drop constraint if exists events_score_is_plausible;
alter table public.events
  add constraint events_score_is_plausible
  check (
    (our_score is null or (our_score >= 0 and our_score <= 99))
    and (their_score is null or (their_score >= 0 and their_score <= 99))
  );

comment on column public.events.our_score is
  'Goals for this academy''s team. Ours and theirs rather than home and away,
   because an imported fixture often does not say which side was at home and
   guessing prints a win as a loss.';

/**
 * Record what happened.
 *
 * A coach's job, and only for a game that has actually kicked off — a result
 * entered for next Saturday is either a typo or a prank, and either way it
 * goes out to every family in the squad.
 *
 * Passing nulls CLEARS the result, which is the only way to take back a score
 * typed into the wrong game. Clearing is allowed; silently leaving a wrong
 * score because the form had no way to empty it is not.
 */
create or replace function public.set_event_result(
  p_event  uuid,
  -- Defaulted to null because CLEARING is a real call, not an edge case: it
  -- is the only way to take back a score typed into the wrong game. Without
  -- the defaults the generated client types say `number`, and the one
  -- operation that has to pass null is the one the types forbid.
  p_ours   integer default null,
  p_theirs integer default null,
  p_note   text    default null,
  p_home   boolean default null
)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;

  -- coalesce on both, because a non-member gets NULL from these and
  -- `if not null` never fires — the hole 0092 was written to close.
  if not (coalesce(app_private.is_academy_staff(v_event.academy_id), false)
          or (v_event.team_id is not null
              and coalesce(app_private.is_team_coach(v_event.team_id), false))) then
    raise exception 'only a coach can record a result' using errcode = '42501';
  end if;

  -- The one place two scores could appear for one game. Refused rather than
  -- quietly written, because the score families would read here is not the
  -- one the ladder was built from.
  if v_event.fixture_id is not null then
    raise exception 'this game is in a competition — the score goes on the fixture, where the table reads it'
      using errcode = '22023';
  end if;

  if v_event.type not in ('match', 'tournament') then
    raise exception 'only a match has a result' using errcode = '22023';
  end if;

  if p_ours is not null and v_event.starts_at > now() then
    raise exception 'that game has not been played yet' using errcode = '22023';
  end if;

  update public.events
     set our_score   = p_ours,
         their_score = p_theirs,
         was_home    = coalesce(p_home, was_home),
         result_note = nullif(btrim(coalesce(p_note, '')), ''),
         -- Cleared along with the score, so "entered by" never names somebody
         -- for a result that is no longer there.
         score_entered_by = case when p_ours is null then null else auth.uid() end,
         score_entered_at = case when p_ours is null then null else now() end
   where id = p_event;
end;
$fn$;

revoke execute on function public.set_event_result(uuid, integer, integer, text, boolean)
  from public, anon;
grant execute on function public.set_event_result(uuid, integer, integer, text, boolean)
  to authenticated;

/**
 * The result of a game, wherever it actually lives.
 *
 * The resolver that stops the two storage places from becoming two answers.
 * A competition fixture wins, because that is what the ladder is built from.
 *
 * `outcome` is computed here rather than in each screen: 'won' / 'lost' /
 * 'drew' from this academy's point of view, which is the only point of view
 * an event has. Three screens working it out from two integers is three
 * chances to get the sign the wrong way round.
 */
create or replace function public.event_result(p_event uuid)
returns table (
  ours     integer,
  theirs   integer,
  outcome  text,
  note     text,
  was_home boolean,
  source   text,
  entered_at timestamptz,
  entered_by text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_event public.events;
  v_fix   public.fixtures;
  v_ours  integer;
  v_their integer;
  v_src   text;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    return;
  end if;

  -- Reading a result is reading the event, so it answers to the same rule as
  -- the event — including `private_to`, which is the fourth visibility rule
  -- and has to be honoured by every reader.
  if not coalesce(app_private.can_read_event(p_event), false) then
    return;
  end if;

  if v_event.fixture_id is not null then
    select * into v_fix from public.fixtures where id = v_event.fixture_id;
    if v_fix.home_score is not null then
      -- Which side of the fixture this academy's team is on decides which
      -- number is "ours". Getting this backwards would show a win as a loss
      -- on the one screen a parent looks at on Sunday morning.
      if exists (
        select 1 from public.competition_entries ce
         where ce.id = v_fix.home_entry_id and ce.team_id = v_event.team_id
      ) then
        v_ours := v_fix.home_score; v_their := v_fix.away_score;
      else
        v_ours := v_fix.away_score; v_their := v_fix.home_score;
      end if;
      v_src := 'fixture';
    end if;
  end if;

  if v_ours is null then
    v_ours := v_event.our_score;
    v_their := v_event.their_score;
    v_src := 'event';
  end if;

  if v_ours is null then
    return;
  end if;

  return query select
    v_ours,
    v_their,
    case when v_ours > v_their then 'won'
         when v_ours < v_their then 'lost'
         else 'drew' end,
    v_event.result_note,
    v_event.was_home,
    v_src,
    v_event.score_entered_at,
    (select p.full_name from public.profiles p where p.id = v_event.score_entered_by);
end;
$fn$;

revoke execute on function public.event_result(uuid) from public, anon;
grant execute on function public.event_result(uuid) to authenticated;

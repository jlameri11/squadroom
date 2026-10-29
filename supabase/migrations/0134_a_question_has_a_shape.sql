-- 0134: a program's questions have a shape, and the database holds it.
--
-- R-11. `programs.questions` has been `[{id, label, type, required}]` since
-- 0083, by comment. Nothing checked it beyond "is an array", nothing
-- rendered `type` — every question was a text box, and a yes/no question
-- was a box somebody typed "yes" into — and there was no screen to write
-- one, so questions existed only for a club willing to type JSON into the
-- database.
--
-- This is the shape, enforced where every writer passes through: a trigger
-- on the column, not a check in the editor. The editor is one writer; the
-- roster import, a script and a future API are three more.
--
-- NORMALISED, NOT JUST CHECKED. A question with no `type` is a text
-- question and is WRITTEN BACK as one, so every reader can rely on the field
-- being there; `required` defaults to false the same way; `options` on
-- anything but a choice is dropped rather than refused, because a question
-- that used to be a choice and is now free text should not need its old
-- options deleted by hand first. Refusals are for things that cannot be
-- made right silently: a duplicate id, a choice with one option, a type
-- this product does not render.
--
-- FOUR TYPES, NOT FIVE. The brief lists file upload. A file from a stranger
-- — the register page is public — is an upload surface with no account
-- behind it, and that needs a size cap, a type allow-list, a bucket policy
-- and a rate limit decided on purpose. Logged under NEEDS JOEY rather than
-- built in a hurry at night.

create or replace function app_private.normalise_questions(p_questions jsonb)
returns jsonb
language plpgsql immutable as $fn$
declare
  v_out   jsonb := '[]'::jsonb;
  v_q     jsonb;
  v_id    text;
  v_label text;
  v_type  text;
  v_opts  jsonb;
  v_seen  text[] := '{}';
  v_n     integer := 0;
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'questions must be a list' using errcode = '22023';
  end if;

  for v_q in select * from jsonb_array_elements(p_questions) loop
    v_n := v_n + 1;
    if v_n > 20 then
      raise exception 'twenty questions is the most a form can ask' using errcode = '22023';
    end if;
    if jsonb_typeof(v_q) <> 'object' then
      raise exception 'question % is not an object', v_n using errcode = '22023';
    end if;

    v_id := btrim(coalesce(v_q->>'id', ''));
    if v_id !~ '^[a-z0-9_-]{1,40}$' then
      raise exception 'question % needs an id of letters, digits, _ or -', v_n using errcode = '22023';
    end if;
    if v_id = any(v_seen) then
      raise exception 'two questions share the id "%"', v_id using errcode = '22023';
    end if;
    v_seen := v_seen || v_id;

    v_label := btrim(coalesce(v_q->>'label', ''));
    if v_label = '' then
      raise exception 'question "%" has no label', v_id using errcode = '22023';
    end if;
    if length(v_label) > 200 then
      raise exception 'question "%" has a label over 200 characters', v_id using errcode = '22023';
    end if;

    -- Missing means text. That is what every question was before this.
    v_type := coalesce(nullif(btrim(v_q->>'type'), ''), 'text');
    if v_type not in ('text', 'choice', 'yesno', 'date') then
      raise exception 'question "%" has a type this form cannot ask: %', v_id, v_type
        using errcode = '22023';
    end if;

    if v_type = 'choice' then
      v_opts := v_q->'options';
      if v_opts is null or jsonb_typeof(v_opts) <> 'array' then
        raise exception 'choice "%" needs a list of options', v_id using errcode = '22023';
      end if;
      -- Trimmed, blanks dropped, duplicates dropped, order kept.
      select coalesce(jsonb_agg(o order by ord), '[]'::jsonb) into v_opts
        from (
          select min(ord) as ord, o
            from (
              select ord, btrim(value #>> '{}') as o
                from jsonb_array_elements(v_opts) with ordinality as t(value, ord)
            ) s
           where o <> ''
           group by o
        ) d;
      if jsonb_array_length(v_opts) < 2 then
        raise exception 'choice "%" needs at least two different options', v_id
          using errcode = '22023';
      end if;
      if jsonb_array_length(v_opts) > 12 then
        raise exception 'choice "%" has more than twelve options — that is a text question', v_id
          using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements_text(v_opts) o where length(o) > 80) then
        raise exception 'an option on "%" is over 80 characters', v_id using errcode = '22023';
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'id',       v_id,
      'label',    v_label,
      'type',     v_type,
      'required', coalesce((v_q->>'required')::boolean, false)
    ) || case when v_type = 'choice' then jsonb_build_object('options', v_opts) else '{}'::jsonb end;
  end loop;

  return v_out;
end;
$fn$;

create or replace function public.programs_normalise_questions()
returns trigger
language plpgsql as $fn$
begin
  -- Only when it changes, so an unrelated update to a program written before
  -- this migration does not refuse over a question nobody touched.
  if tg_op = 'INSERT' or new.questions is distinct from old.questions then
    new.questions := app_private.normalise_questions(new.questions);
  end if;
  return new;
end;
$fn$;

drop trigger if exists programs_questions_shape on public.programs;
create trigger programs_questions_shape
  before insert or update of questions on public.programs
  for each row execute function public.programs_normalise_questions();

-- Trigger functions are not callable through PostgREST, but 0132 closed the
-- default and the habit is worth keeping.
revoke execute on function public.programs_normalise_questions() from public, anon, authenticated;

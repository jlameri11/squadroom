-- 0135: a choice question keeps its options.
--
-- 0134 built each normalised question as
--
--   v_out := v_out || jsonb_build_object(…) || case … jsonb_build_object('options', …) end;
--
-- and `||` is left-associative. `[] || {question}` appends the question as
-- an element — right — and then `[…] || {options}` appends the options as a
-- SECOND element, not as a key on the first. So a choice came back as
-- `{id, label, type, required}` followed by `{options: […]}`, and a text
-- question was followed by `{}`.
--
-- Caught by test-program-questions on its first run — "options came back as
-- undefined" — and the shape of the wreckage is what made the cause obvious:
-- the check that a date question's options were dropped had passed by
-- landing on one of the stray `{}` elements.
--
-- The element is now built whole and appended with jsonb_build_array, which
-- says what it means. Nothing stored is affected: the trigger only fires
-- when `questions` changes, and the one program written under 0134 was a
-- test's, deleted by it.

create or replace function app_private.normalise_questions(p_questions jsonb)
returns jsonb
language plpgsql immutable as $fn$
declare
  v_out   jsonb := '[]'::jsonb;
  v_q     jsonb;
  v_elem  jsonb;
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

    -- Missing means text. That is what every question was before 0134.
    v_type := coalesce(nullif(btrim(v_q->>'type'), ''), 'text');
    if v_type not in ('text', 'choice', 'yesno', 'date') then
      raise exception 'question "%" has a type this form cannot ask: %', v_id, v_type
        using errcode = '22023';
    end if;

    v_elem := jsonb_build_object(
      'id',       v_id,
      'label',    v_label,
      'type',     v_type,
      'required', coalesce((v_q->>'required')::boolean, false)
    );

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
      -- Object || object merges keys. That is the operation 0134 meant.
      v_elem := v_elem || jsonb_build_object('options', v_opts);
    end if;

    v_out := v_out || jsonb_build_array(v_elem);
  end loop;

  return v_out;
end;
$fn$;

-- 0195: polls from before 0044 learn the new shape.
--
-- 0044 made a poll option an object — {"id": …, "label": …} — and
-- poll_results reads o->>'id' and o->>'label'. The seed's two polls (and
-- any poll made before 0044) kept their options as plain strings, so the
-- card showed three blank options with no votes and React logged a
-- duplicate key for every one of them.
--
-- The label becomes the id, because that is exactly what those polls'
-- votes hold in option_ids: nothing else has to move.
update public.polls p
   set options = (
     select jsonb_agg(
              case when jsonb_typeof(o) = 'string'
                   then jsonb_build_object('id', o #>> '{}', 'label', o #>> '{}')
                   else o end
              order by ord)
       from jsonb_array_elements(p.options) with ordinality as e(o, ord)
   )
 where jsonb_typeof(p.options) = 'array'
   and exists (select 1 from jsonb_array_elements(p.options) o where jsonb_typeof(o) = 'string');

-- test-rls 102 fails if a string-shaped option ever appears again.

-- 0178: a person reads their own language setting.
--
-- 0012 took the table-wide grant off profiles and granted columns one by
-- one, so a new column is invisible to the client until it is granted.
-- The route read null for a parent who had just chosen Arabic and told
-- them to choose a language. Granted; RLS still limits the row to their
-- own and their club's.
grant select (chat_language) on public.profiles to authenticated;

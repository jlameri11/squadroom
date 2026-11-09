-- 0229: "may I post here?" is a question anyone signed in may ask.
--
-- Found by full run #21, the day 0213 went live on squadroom-dev: the
-- league's owner opened their competition's Notices and got no composer.
-- The chat page asks public.can_post_in_channel as the person, and the
-- answer was "permission denied for function" — the public wrapper (0011,
-- re-made in 0169) never carried EXECUTE for authenticated, and nothing
-- noticed because the chat's own policies ask the app_private helper
-- directly. The page took "denied" for "no", and the league could read its
-- own Notices and not post in them.
--
-- The function says only whether the caller may post in a channel they can
-- already see (app_private.can_post_in_channel names the caller). Signed-in
-- people may ask it; strangers still may not (0185's list is unchanged).
revoke execute on function public.can_post_in_channel(uuid, uuid) from public, anon;
grant execute on function public.can_post_in_channel(uuid, uuid) to authenticated;

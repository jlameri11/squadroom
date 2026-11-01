-- 0177: read it in your own language.
--
-- W-08. A Sydney junior club is a dozen languages; the coach writes in
-- English and a third of the parents read it through a translation app,
-- or do not read it. A person chooses a language in Settings (off by
-- default) and messages render in it, with the original one tap away —
-- the original is always what was said; the translation is a courtesy.
--
-- TRANSLATED ONCE PER MESSAGE PER LANGUAGE, by a route with the service
-- role, and cached here; a hundred Arabic-reading parents in one channel
-- cost one translation. CAPPED like the scan feature (0059): per person
-- and per club per day, counted in the database so a client cannot talk
-- its way past it. Read only by members of the message's channel, the same
-- rule as the message. Never a child's data: the model sees the message
-- body and nothing else.

alter table public.profiles add column if not exists chat_language text
  check (chat_language is null or chat_language ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$');

create table if not exists public.message_translations (
  message_id  uuid not null references public.messages(id) on delete cascade,
  channel_id  uuid not null,
  lang        text not null,
  body        text not null,
  model       text,
  created_at  timestamptz not null default now(),
  primary key (message_id, lang)
);
alter table public.message_translations enable row level security;
create policy message_translations_select on public.message_translations for select to authenticated
  using ((select app_private.is_channel_member(message_translations.channel_id)));

-- The spend ledger: one row per batch, counted by the function below.
create table if not exists public.translation_takes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  academy_id  uuid not null references public.academies(id) on delete cascade,
  n           integer not null check (n > 0),
  created_at  timestamptz not null default now()
);
alter table public.translation_takes enable row level security;
create index if not exists translation_takes_profile_idx on public.translation_takes (profile_id, created_at desc);
create index if not exists translation_takes_academy_idx on public.translation_takes (academy_id, created_at desc);

create or replace function public.set_chat_language(p_lang text)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  update public.profiles set chat_language = nullif(btrim(coalesce(p_lang, '')), '') where id = auth.uid();
end;
$fn$;

-- What is already translated, for the messages this person may read.
create or replace function public.translations_for(p_message_ids uuid[], p_lang text)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_object_agg(t.message_id, t.body), '{}'::jsonb)
    from public.message_translations t
   where t.message_id = any (p_message_ids)
     and t.lang = p_lang
     and app_private.is_channel_member(t.channel_id);
$fn$;

-- Service role only: count a batch against the person and the club, or
-- refuse. 300 messages a person a day, 3,000 a club a day — generous for
-- reading a chat, nothing like a runaway loop.
create or replace function public.translation_budget_take(p_profile uuid, p_academy uuid, p_n integer)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_person integer;
  v_club integer;
begin
  if p_n < 1 or p_n > 50 then raise exception 'batches are 1 to 50' using errcode = '22023'; end if;
  select coalesce(sum(n), 0) into v_person from public.translation_takes where profile_id = p_profile and created_at > now() - interval '24 hours';
  select coalesce(sum(n), 0) into v_club from public.translation_takes where academy_id = p_academy and created_at > now() - interval '24 hours';
  if v_person + p_n > 300 then
    raise exception 'That is enough translating for one day (300 messages). Tomorrow it clears.' using errcode = '53400';
  end if;
  if v_club + p_n > 3000 then
    raise exception 'The club has used its translation budget for today.' using errcode = '53400';
  end if;
  insert into public.translation_takes (profile_id, academy_id, n) values (p_profile, p_academy, p_n);
end;
$fn$;

revoke execute on function public.translation_budget_take(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.translation_budget_take(uuid, uuid, integer) to service_role;
grant execute on function public.set_chat_language(text) to authenticated;
grant execute on function public.translations_for(uuid[], text) to authenticated;

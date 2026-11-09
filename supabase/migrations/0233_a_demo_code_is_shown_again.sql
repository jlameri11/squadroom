-- 0233: a demo account's code is kept readable, so a reload shows it again.
--
-- 0232 holds every code we make as a salted hash and lets a second ask
-- inside a minute send nothing new (a text costs money). For a demo or
-- placeholder account the code is never sent anywhere — it is shown on the
-- wall — and a reload inside that minute would have shown a wall with no
-- code on it. The demo code is kept in the clear beside its hash, for the
-- screen only; a real account's code never is (the column stays null).
-- Found by test-two-step's first run on squadroom-dev.
alter table public.two_step_codes add column if not exists demo_code text;
alter table public.two_step_codes drop constraint if exists two_step_codes_demo_code_is_demo;
alter table public.two_step_codes add constraint two_step_codes_demo_code_is_demo
  check (demo_code is null or channel = 'demo');

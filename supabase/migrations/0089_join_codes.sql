-- 0089: a code you can read out loud.
--
-- A join link's token is 24 hex characters. That is right for a QR code and
-- for a link pasted into WhatsApp, and useless for every other way a coach
-- actually recruits: saying it at the end of training, writing it on a
-- whiteboard, printing it on a flyer at the school gate, reading it down the
-- phone to a grandparent. "squadroom.app/join/9f3c1e77ab42" cannot be
-- dictated. "Join code: 7K4PQM" can.
--
-- So every join link gains a short code, and the code is an ALTERNATIVE SPELLING
-- of the same link — not a second mechanism. Same expiry, same use limit, same
-- revocation, same coach approval at the end of it. There is exactly one way
-- into this academy and this adds a way to say it.
--
-- THE ALPHABET MATTERS. 0/O and 1/I/L are the reason people mistype codes, and
-- a code read out at training is transcribed by twenty parents at once. The
-- alphabet below drops both pairs, and U as well — six characters drawn at
-- random will otherwise occasionally spell something a club does not want on
-- a flyer. 30 characters, 6 long, is 729 million codes.
--
-- NO NEW PUBLIC ENDPOINT. There is deliberately no anon-callable
-- code-to-token resolver: that would be a free oracle for guessing codes. The
-- join page already reads links with the service role, because an
-- unauthenticated visitor has no identity to read them with, so it simply
-- looks up token OR code. Nothing new is exposed.

create or replace function app_private.new_join_code()
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  -- No O/0, no I/1/L, no U.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_code     text;
  v_tries    integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;

    exit when not exists (select 1 from public.join_links where code = v_code);

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

alter table public.join_links
  add column if not exists code text;

-- Backfill before the constraint, or every existing link is a violation.
update public.join_links
   set code = app_private.new_join_code()
 where code is null;

alter table public.join_links
  alter column code set not null,
  alter column code set default app_private.new_join_code();

-- Unique across the whole product, not per academy. A parent typing a code
-- has not told us which academy they mean — that is the entire point of
-- typing a code — so it has to identify one on its own.
create unique index if not exists join_links_code_key on public.join_links (code);

-- Stored and compared upper case, so a parent typing lower case is not told
-- their coach gave them a bad code.
alter table public.join_links
  add constraint join_links_code_shape
  check (code ~ '^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$');

comment on column public.join_links.code is
  'A short, dictatable spelling of this link''s token. Same expiry, same use
   limit, same revocation, same coach approval. Resolved server-side with the
   service role — there is deliberately no anon-callable lookup, which would
   be an oracle for guessing codes.';

-- 0108: S-02. Reporting a message, and somebody whose job it is to read it.
--
-- The spec calls this small and non-negotiable, and it has been outstanding
-- since the safeguarding phase. DRIBL_INTEL puts it in "gaps nobody fills":
-- Dribl has no message reporting because Dribl has no messages, and WhatsApp
-- has no concept of a club officer at all. A product that puts adults and
-- children's names in the same conversation needs a way to say "look at
-- this" that does not depend on knowing the owner's phone number.
--
-- WHAT A REPORT IS. A request for a human to look, not an action. Reporting
-- does not hide the message, does not notify the sender, and does not delete
-- anything — an officer decides, and deleting a message somebody reported is
-- exactly the thing a parent would want a record of either way.
--
-- A SAFEGUARDING OFFICER IS A SEPARATE TABLE, not a new value in
-- academy_role. That enum is named in dozens of policies and helpers, and
-- widening it to carry one extra responsibility would mean auditing every one
-- of them — for a role that is orthogonal to coaching anyway. The club's
-- Child Safe Officer is often not a coach at all, which is rather the point.
--
-- WHO SEES A REPORT. Officers, and the academy's owner so there is always
-- somebody. Explicitly NOT coaches: a coach may be the subject of the report,
-- and the whole mechanism is worthless if the person complained about can
-- read the complaint. Never the sender, and never who reported them.

do $$ begin
  create type public.report_reason as enum (
    'inappropriate',     -- language, content, tone
    'bullying',
    'safeguarding',      -- a child's welfare
    'spam',
    'wrong_channel',     -- a private matter in a team chat
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_status as enum ('open', 'actioned', 'dismissed');
exception when duplicate_object then null; end $$;

-- Who reads the reports. Additive, so no existing policy changes meaning.
create table if not exists public.safeguarding_officers (
  academy_id uuid not null references public.academies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Recorded because "who appointed the officer" is a question a Child Safe
  -- audit asks, and the answer should not be "nobody knows".
  appointed_by uuid references public.profiles(id) on delete set null,
  appointed_at timestamptz not null default now(),
  primary key (academy_id, profile_id)
);

alter table public.safeguarding_officers enable row level security;

-- Who the officers are is not a secret — a parent should be able to find out
-- who to escalate to, which is a Child Safe Standard in itself.
create policy safeguarding_officers_select on public.safeguarding_officers
  for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

-- Appointed by the owner or an admin only. A coach appointing the person who
-- would review a complaint about them is the obvious hole.
create policy safeguarding_officers_write on public.safeguarding_officers
  for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

create or replace function app_private.is_safeguarding_officer(p_academy uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  -- coalesce, because `exists` is never null but the owner check behind it
  -- comes from academy_role_of — and 0092 is the whole story about what
  -- happens when a guard returns null.
  select coalesce(
    exists (
      select 1 from public.safeguarding_officers o
       where o.academy_id = p_academy and o.profile_id = auth.uid()
    )
    -- The owner always can, so a club that has appointed nobody is not a club
    -- where reports go unread.
    or app_private.academy_role_of(p_academy) = 'owner',
    false
  );
$fn$;

create table if not exists public.message_reports (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  message_id  uuid not null,
  channel_id  uuid not null,
  reported_by uuid not null references public.profiles(id) on delete cascade,
  reason      public.report_reason not null,
  note        text,

  status      public.report_status not null default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  -- What was actually done, in the officer's words. A status alone does not
  -- survive being asked about in a year.
  outcome     text,

  created_at  timestamptz not null default now(),

  -- One report per person per message. A second concern about the same
  -- message goes in the note rather than inflating a count.
  constraint message_reports_once unique (message_id, reported_by),

  constraint message_reports_id_academy_key unique (id, academy_id),
  constraint message_reports_message_fkey foreign key (message_id, academy_id)
    references public.messages (id, academy_id) on delete cascade,
  constraint message_reports_channel_fkey foreign key (channel_id, academy_id)
    references public.channels (id, academy_id) on delete cascade
);

create index if not exists message_reports_open_idx
  on public.message_reports (academy_id, status, created_at desc);

alter table public.message_reports enable row level security;

-- Officers and the owner. NOT coaches, and not the sender: a mechanism the
-- subject of a complaint can read is not a mechanism.
create policy message_reports_select on public.message_reports
  for select to authenticated
  using (
    (select app_private.is_safeguarding_officer(academy_id))
    -- Somebody can see the report they made, so they know it was received.
    or reported_by = (select auth.uid())
  );

-- Anybody who can see the message can report it. Written through the RPC
-- below rather than directly, so the channel and academy on the row cannot
-- be made to disagree with the message's own.
create policy message_reports_insert on public.message_reports
  for insert to authenticated
  with check (false);

create policy message_reports_update on public.message_reports
  for update to authenticated
  using ((select app_private.is_safeguarding_officer(academy_id)))
  with check ((select app_private.is_safeguarding_officer(academy_id)));

-- Nobody. A report is a record, and a club that can delete its reports has
-- no record at all.
create policy message_reports_delete on public.message_reports
  for delete to authenticated
  using (false);

/**
 * Report a message.
 *
 * The channel and academy are taken from the MESSAGE, never from the caller,
 * so a report cannot be filed against one academy's message in another's
 * queue. The only thing the caller supplies is which message, why, and what
 * they want to say.
 *
 * Refuses a message the caller cannot see, through `is_channel_member` —
 * which also means reporting cannot be used to discover whether a message
 * exists.
 */
create or replace function public.report_message(
  p_message uuid,
  p_reason  public.report_reason,
  p_note    text default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_msg public.messages;
  v_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_msg from public.messages where id = p_message;

  -- Indistinguishable from "no such message", on purpose.
  if v_msg.id is null or not app_private.is_channel_member(v_msg.channel_id) then
    raise exception 'no such message' using errcode = '22023';
  end if;

  -- Reporting your own message is not a thing that needs preventing for
  -- safety, but it is almost always a mistap.
  if v_msg.sender_id = auth.uid() then
    raise exception 'that is your own message' using errcode = '22023';
  end if;

  insert into public.message_reports (
    academy_id, message_id, channel_id, reported_by, reason, note
  ) values (
    v_msg.academy_id, p_message, v_msg.channel_id, auth.uid(),
    p_reason, nullif(btrim(coalesce(p_note, '')), '')
  )
  on conflict (message_id, reported_by) do update
    set reason = excluded.reason,
        note = coalesce(excluded.note, public.message_reports.note)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.report_message(uuid, public.report_reason, text)
  from public, anon;
grant execute on function public.report_message(uuid, public.report_reason, text)
  to authenticated;

/**
 * The queue, with enough of the message to judge it.
 *
 * Carries the body and the sender, because an officer cannot act on "a
 * message in U8 SPL was reported" and should not have to go hunting for it in
 * a thread — which would also mean joining a channel they may not be in.
 *
 * A deleted message still appears, with its body withheld exactly as the
 * tombstone withholds it elsewhere. That a reported message was then deleted
 * is the most interesting thing that can happen to a report.
 */
create or replace function public.safeguarding_queue(
  p_academy uuid default null,
  p_status  public.report_status default 'open'
)
returns table (
  report_id    uuid,
  reason       public.report_reason,
  note         text,
  status       public.report_status,
  created_at   timestamptz,
  reporter     text,
  channel_name text,
  sender_name  text,
  body         text,
  deleted      boolean,
  outcome      text,
  reviewed_by  text,
  reviewed_at  timestamptz
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then return; end if;

  if not app_private.is_safeguarding_officer(v_academy) then
    raise exception 'only a safeguarding officer or the club owner can read reports'
      using errcode = '42501';
  end if;

  return query
  select r.id, r.reason, r.note, r.status, r.created_at,
         rep.full_name,
         coalesce(c.name, 'Direct message'),
         snd.full_name,
         case when m.deleted_at is null then m.body else null end,
         m.deleted_at is not null,
         r.outcome,
         rev.full_name,
         r.reviewed_at
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    left join public.channels c on c.id = r.channel_id
    left join public.profiles rep on rep.id = r.reported_by
    left join public.profiles snd on snd.id = m.sender_id
    left join public.profiles rev on rev.id = r.reviewed_by
   where r.academy_id = v_academy
     and (p_status is null or r.status = p_status)
   order by r.created_at desc;
end;
$fn$;

revoke execute on function public.safeguarding_queue(uuid, public.report_status)
  from public, anon;
grant execute on function public.safeguarding_queue(uuid, public.report_status)
  to authenticated;

/**
 * Close a report, with what was done about it.
 *
 * An outcome is required. "Dismissed" with no sentence is the state a club
 * cannot defend a year later, and writing one line is not a burden next to
 * the alternative.
 */
create or replace function public.review_report(
  p_report  uuid,
  p_status  public.report_status,
  p_outcome text
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.message_reports where id = p_report;
  if v_academy is null then
    raise exception 'no such report' using errcode = '22023';
  end if;
  if not app_private.is_safeguarding_officer(v_academy) then
    raise exception 'only a safeguarding officer or the club owner can review reports'
      using errcode = '42501';
  end if;
  if p_status = 'open' then
    raise exception 'use actioned or dismissed to close a report' using errcode = '22023';
  end if;
  if btrim(coalesce(p_outcome, '')) = '' then
    raise exception 'say what was done — a closed report with no note is not a record'
      using errcode = '22023';
  end if;

  update public.message_reports
     set status = p_status,
         outcome = btrim(p_outcome),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_report;

  return true;
end;
$fn$;

revoke execute on function public.review_report(uuid, public.report_status, text)
  from public, anon;
grant execute on function public.review_report(uuid, public.report_status, text)
  to authenticated;

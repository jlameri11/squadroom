-- 0127: S-05. Export and erase.
--
-- The Children's Online Privacy Code applies from 10 December 2026. This is a
-- product built entirely around other people's children, in Australia, and
-- two of the Code's obligations are plain software: a family can get a copy
-- of what is held about them, and can have it erased.
--
-- The legal review still has to happen and is not something code can do. The
-- part code can do is be ready for it, and the part worth thinking hardest
-- about is not the deletion. It is WHAT IS KEPT, and whether each thing kept
-- has a reason that survives being read out loud.
--
-- WHAT IS KEPT, AND WHY:
--
--   SAFEGUARDING REPORTS. A report naming somebody must not be erasable BY
--   that somebody. A club that can delete its reports has no reports, which
--   is why `message_reports` already refuses deletion to everyone including
--   its owner. Erasure does not touch them.
--
--   PAYMENTS. Financial records, with a statutory retention period of five
--   years in Australia. The amount and the date stay; they are the club's
--   books, not the family's data.
--
--   CLEARANCES. A club's record that it verified a Working With Children
--   Check is the club's legal obligation, not the holder's property. A coach
--   cannot erase the evidence that they were checked.
--
--   MESSAGES. Tombstoned, never removed. Deleting somebody's messages
--   rewrites other people's conversations — a thread where half the replies
--   answer nothing is worse for everyone than a row of "message removed".
--   This is the pattern the product already uses for a deleted message.
--
--   THE CHILD. A roster row belongs to the CLUB. A guardian who erases
--   themselves does not get to delete a child the club has other guardians
--   for, a season of attendance against, and a match sheet naming. The
--   guardian LINK goes; the child stays, and the club is told — because a
--   child left on a roster with nobody to ring is a child nobody can
--   collect from training.
--
-- Everything else goes: the profile is redacted, the medical record is
-- deleted outright (the most sensitive thing here and the one with no
-- retention basis at all once a family leaves), and every note a person
-- typed goes with it.
--
-- The function returns a MANIFEST of what it did. That is the compliance
-- artifact: "we erased you" is not an answer anybody can check.

alter table public.profiles
  add column if not exists erased_at timestamptz;

comment on column public.profiles.erased_at is
  'Set by erase_me(). The row survives because other rows point at it —
   tombstoned messages, payments, safeguarding reports — but every personal
   detail on it has been redacted.';

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;

alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing',
    'rsvp_change', 'invite', 'event_cancelled', 'event_changed', 'event_back_on',
    'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring',
    -- 0127. A child whose last guardian has erased themselves is a child
    -- nobody can ring about training. The club has to be told, and it is not
    -- a thing a club should discover.
    'guardian_erased'
  ]));

/**
 * Everything held about me and my children.
 *
 * One call, machine-readable, no arguments. A person asking what is held
 * about them should not have to know the shape of the product to ask.
 *
 * Scoped to THIS PERSON, by `auth.uid()` and the guardian links — never by an
 * academy id a caller passes in, which would make an export function a way to
 * read somebody else's club. Children are included because a guardian acts
 * for them: that is the whole premise of the product, and a family's data is
 * not two separate requests.
 *
 * It deliberately does NOT include other people. A team chat is other
 * families' words, and a parent exporting "their" data must not come away
 * with a transcript of everybody else's. Their OWN messages are listed; the
 * replies are not.
 */
create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'about', 'Everything Squadroom holds about you and the children you are a guardian of. Other people''s messages and details are not included.',

    'you', (
      select jsonb_build_object(
        'name', p.full_name,
        'phone', p.phone::text,
        'joined', p.created_at
      ) from public.profiles p where p.id = v_me
    ),

    'clubs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'club', a.name,
               'role', am.role,
               'status', am.status,
               'joined', am.joined_at
             ) order by a.name)
        from public.academy_members am
        join public.academies a on a.id = am.academy_id
       where am.profile_id = v_me
    ), '[]'::jsonb),

    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', pl.full_name,
               'goes_by', pl.preferred_name,
               'date_of_birth', pl.dob,
               'gender', pl.gender,
               'school', pl.school,
               'football_number', pl.ff_number,
               'squad', (select t.name from public.teams t where t.id = pl.team_id),
               'kit', jsonb_build_object(
                 'shirt', pl.shirt_size, 'shorts', pl.shorts_size, 'socks', pl.socks_size
               ),
               'your_relationship', pg.relationship,
               -- The most sensitive thing held about a child, so it is
               -- included in full: an export that quietly left out the
               -- medical record would be an export nobody could rely on.
               'medical', (
                 select to_jsonb(m) - 'id' - 'academy_id' - 'player_id'
                   from public.player_medical m where m.player_id = pl.id
               ),
               'consents', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'document', cd.title,
                          'version', cd.version,
                          'agreed', ca.accepted,
                          'when', ca.accepted_at
                        ) order by ca.accepted_at)
                   from public.consent_acceptances ca
                   join public.consent_documents cd on cd.id = ca.document_id
                  where ca.player_id = pl.id
               ), '[]'::jsonb)
             ) order by pl.full_name)
        from public.players pl
        join public.player_guardians pg
          on pg.player_id = pl.id and pg.profile_id = v_me
    ), '[]'::jsonb),

    'your_answers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'game', e.title,
               'when', e.starts_at,
               'child', pl.full_name,
               'answer', r.status,
               'your_note', r.note
             ) order by e.starts_at desc)
        from public.event_rsvps r
        join public.events e on e.id = r.event_id
        left join public.players pl on pl.id = r.player_id
       where r.profile_id = v_me
    ), '[]'::jsonb),

    -- The person's own words only. Everybody else's replies are their data,
    -- not this person's, and an export is not a way to take a copy of a
    -- club's conversations home.
    'your_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', c.name,
               'when', m.created_at,
               'text', case when m.deleted_at is null then m.body else null end,
               'deleted', m.deleted_at is not null
             ) order by m.created_at desc)
        from public.messages m
        join public.channels c on c.id = m.channel_id
       where m.sender_id = v_me
    ), '[]'::jsonb),

    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'what', r.title,
               'amount_cents', p.amount_cents,
               'status', p.status,
               'paid_at', p.paid_at,
               'child', (select pl.full_name from public.players pl where pl.id = p.player_id)
             ) order by p.created_at desc)
        from public.payments p
        join public.payment_requests r on r.id = p.request_id
       where p.profile_id = v_me
    ), '[]'::jsonb),

    'settings', (
      select to_jsonb(us) - 'profile_id' from public.user_settings us where us.profile_id = v_me
    ),

    'devices_sent_notifications', (
      select count(*)::integer from public.push_subscriptions ps where ps.profile_id = v_me
    )
  );
end;
$fn$;

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

/**
 * Erase me.
 *
 * Immediate and self-service, because a right that needs somebody's
 * permission is not a right. It is also irreversible, so the screen in front
 * of it says so plainly and names what will be kept.
 *
 * Returns a manifest. "We erased you" is not an answer anybody can check,
 * and the manifest is what makes this auditable — including the list of
 * things that were deliberately NOT erased, each with the reason.
 *
 * The AUTH USER is not deleted here. That needs the service role, so the
 * route calls this first and then removes the login: this function leaves
 * the profile redacted and `erased_at` set, which is the state that matters
 * if the second half ever fails.
 */
create or replace function public.erase_me()
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me        uuid := auth.uid();
  v_name      text;
  v_messages  integer;
  v_rsvps     integer;
  v_medical   integer;
  v_orphans   jsonb := '[]'::jsonb;
  v_kept      jsonb;
  v_child     record;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select full_name into v_name from public.profiles where id = v_me;

  -- A child whose only guardian this is. Collected BEFORE the links are cut,
  -- because afterwards there is no way to know which children were affected
  -- — and a child on a roster with nobody to ring is a child nobody can
  -- collect from training.
  for v_child in
    select pl.id, pl.full_name, pl.academy_id, pl.team_id
      from public.players pl
      join public.player_guardians pg
        on pg.player_id = pl.id and pg.profile_id = v_me
     where not exists (
       select 1 from public.player_guardians other
        where other.player_id = pl.id and other.profile_id <> v_me
     )
  loop
    v_orphans := v_orphans || jsonb_build_object(
      'child', v_child.full_name,
      'academy_id', v_child.academy_id
    );

    -- Told, not discovered. Goes to the club's owners and admins, who are
    -- the people who can ring the other parent.
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select v_child.academy_id, am.profile_id, 'guardian_erased',
           'A player has no contact now',
           v_child.full_name || ' has no guardian on file — their last one asked to be removed.',
           '/admin/teams',
           jsonb_build_object('player_id', v_child.id)
      from public.academy_members am
     where am.academy_id = v_child.academy_id
       and am.status = 'active'
       and am.role in ('owner', 'admin');
  end loop;

  -- Medical first, and outright. The most sensitive thing in the product and
  -- the one with no retention basis whatever once a family leaves.
  with gone as (
    delete from public.player_medical m
     where m.player_id in (
       select pg.player_id from public.player_guardians pg where pg.profile_id = v_me
     )
     -- Only where this person is the LAST guardian. Another parent's child's
     -- medical record is not this person's to erase.
     and not exists (
       select 1 from public.player_guardians other
        where other.player_id = m.player_id and other.profile_id <> v_me
     )
    returning 1
  )
  select count(*)::integer into v_medical from gone;

  -- The guardian link. The child stays: see the note at the top.
  delete from public.player_guardians where profile_id = v_me;

  -- Tombstoned, not deleted. A thread where half the replies answer nothing
  -- is worse for everyone than a row of "message removed".
  with hushed as (
    update public.messages
       set body = null, attachments = '[]'::jsonb, deleted_at = coalesce(deleted_at, now())
     where sender_id = v_me and deleted_at is null
    returning 1
  )
  select count(*)::integer into v_messages from hushed;

  -- Answers and the notes on them. An RSVP note is a sentence a parent typed
  -- about their own child.
  with wiped as (
    delete from public.event_rsvps where profile_id = v_me returning 1
  )
  select count(*)::integer into v_rsvps from wiped;

  delete from public.poll_votes where profile_id = v_me;
  delete from public.event_attendance where marked_by = v_me;
  delete from public.push_subscriptions where profile_id = v_me;
  delete from public.calendar_feeds where profile_id = v_me;
  delete from public.user_settings where profile_id = v_me;
  delete from public.message_reactions where profile_id = v_me;
  delete from public.channel_members where profile_id = v_me;
  delete from public.team_members where profile_id = v_me;
  delete from public.notification_queue where profile_id = v_me;
  delete from public.event_scans where profile_id = v_me;

  -- Membership ends, but the row stays: `removed_at` is how a club knows
  -- somebody left rather than never existed, and an invite chain with a hole
  -- in it cannot be read.
  update public.academy_members
     set status = 'removed', removed_at = now()
   where profile_id = v_me;

  -- The profile itself. Redacted rather than deleted, because tombstoned
  -- messages, payments and safeguarding reports all point at it — and a
  -- foreign key that falls over is not erasure, it is breakage.
  update public.profiles
     set full_name = 'Removed',
         phone = null,
         avatar_url = null,
         erased_at = now(),
         updated_at = now()
   where id = v_me;

  v_kept := jsonb_build_array(
    jsonb_build_object(
      'what', 'Safeguarding reports',
      'why', 'A report naming somebody cannot be erased by that somebody. A club that can delete its reports has no reports.'
    ),
    jsonb_build_object(
      'what', 'Payment records (amount and date)',
      'why', 'Financial records, kept five years as Australian law requires. They are the club''s books.'
    ),
    jsonb_build_object(
      'what', 'Working With Children Check records, if you are a coach or admin',
      'why', 'The club''s legal record that it verified you, which is the club''s obligation and not yours to remove.'
    ),
    jsonb_build_object(
      'what', 'That you sent messages, without their text',
      'why', 'Deleting them would rewrite other people''s conversations. The text is gone; a "message removed" line is left where each one was.'
    ),
    jsonb_build_object(
      'what', 'Your children''s roster records',
      'why', 'A roster row belongs to the club, which may have another guardian, a season of attendance and match sheets naming them. Your link to them is removed.'
    )
  );

  return jsonb_build_object(
    'erased_at', now(),
    'was', v_name,
    'erased', jsonb_build_object(
      'messages_emptied', v_messages,
      'answers_removed', v_rsvps,
      'medical_records_deleted', v_medical,
      'profile', 'name, phone and photo removed',
      'devices', 'all notification registrations removed',
      'guardian_links', 'removed'
    ),
    'kept', v_kept,
    -- Named so the person can see the consequence they were warned about
    -- actually happened, and so the manifest is the same story the club was
    -- told.
    'children_left_without_a_contact', v_orphans
  );
end;
$fn$;

revoke execute on function public.erase_me() from public, anon;
grant execute on function public.erase_me() to authenticated;

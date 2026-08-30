-- 0012_column_privacy.sql
-- Two things RLS genuinely cannot do, done properly instead of pretended.
--
-- RLS decides whether you get a ROW. It has nothing to say about a COLUMN.
-- So the two places where the product needs column-level privacy — a parent's
-- phone number, and the body of a deleted message — are handled with column
-- grants and a side table, not with a policy that only looks like it works.

-- ===========================================================================
-- 1. Deleted messages
--
-- Soft delete alone is not privacy: if a channel member can still read the
-- row, they can still read the body straight from the API, whatever the UI
-- draws. So deleting a message MOVES its content to an archive only owners
-- and admins can read, and leaves a genuine tombstone behind.
-- ===========================================================================

create table public.deleted_message_archive (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  message_id  uuid not null,
  channel_id  uuid not null,
  sender_id   uuid,
  body        text,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null,
  deleted_at  timestamptz not null default now(),
  deleted_by  uuid,
  -- Child-safety retention: readable by owners/admins for 90 days, then gone.
  purge_after timestamptz not null default now() + interval '90 days'
);
alter table public.deleted_message_archive enable row level security;

-- A tombstone has no body, so the "not empty" rule has to make room for it.
alter table public.messages drop constraint messages_not_empty;
alter table public.messages add constraint messages_not_empty check (
  deleted_at is not null
  or length(btrim(coalesce(body, ''))) > 0
  or jsonb_array_length(attachments) > 0
);

create or replace function public.archive_deleted_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    insert into public.deleted_message_archive
      (academy_id, message_id, channel_id, sender_id, body, attachments, created_at, deleted_by)
    values
      (old.academy_id, old.id, old.channel_id, old.sender_id, old.body, old.attachments,
       old.created_at, new.deleted_by);

    new.body := null;
    new.attachments := '[]'::jsonb;
  end if;
  return new;
end;
$$;

create trigger messages_archive_on_delete
  before update of deleted_at on public.messages
  for each row execute function public.archive_deleted_message();

create or replace function public.purge_expired_message_archive()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  delete from public.deleted_message_archive where purge_after < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================================================================
-- 2. Phone numbers
--
-- profiles rows must be readable across an academy — every message bubble
-- needs a name and an avatar. But the phone number is exactly the thing the
-- academy's directory setting governs, and it sits on the same row.
--
-- Table-level SELECT covers every column, so the fix is to take the table
-- grant away and hand back an explicit column list. The number is then only
-- reachable through the security-definer function below, which applies the
-- academy's setting.
-- ===========================================================================

revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, avatar_url, created_at, updated_at)
  on public.profiles to authenticated;
grant update (full_name, avatar_url)
  on public.profiles to authenticated;

-- The searchable member list. phone comes back null unless the caller is
-- staff/coach, or the academy has opened its directory to everyone.
create or replace function public.member_directory(p_academy uuid)
returns table (
  profile_id uuid,
  full_name  text,
  avatar_url text,
  role       public.academy_role,
  phone      text,
  teams      text[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_can_see boolean;
begin
  if not public.is_academy_member(p_academy) then
    raise exception 'not a member of this academy' using errcode = '42501';
  end if;

  v_can_see := public.can_see_contact_details(p_academy);

  return query
    select
      p.id,
      p.full_name,
      p.avatar_url,
      am.role,
      -- Staff are always contactable; everyone else follows the setting.
      case when v_can_see or am.role in ('owner','admin','coach')
           then p.phone::text else null end,
      coalesce(array_agg(t.name order by t.name)
                 filter (where t.id is not null), '{}')
    from public.academy_members am
    join public.profiles p on p.id = am.profile_id
    left join public.team_members tm on tm.profile_id = p.id and tm.academy_id = p_academy
    left join public.teams t on t.id = tm.team_id and t.status = 'active'
   where am.academy_id = p_academy
     and am.status = 'active'
   group by p.id, p.full_name, p.avatar_url, am.role, p.phone;
end;
$$;

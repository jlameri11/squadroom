-- 0001_extensions_enums.sql
-- Extensions, shared enums, and generic utility triggers.
-- No tables here, so nothing to secure yet.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Role a profile holds within a single academy.
create type public.academy_role as enum ('owner', 'admin', 'coach', 'parent', 'player');

create type public.member_status as enum ('invited', 'active', 'removed');

create type public.invite_status as enum ('pending', 'accepted', 'declined', 'revoked', 'expired');

-- Teams are archived, never deleted: an ended season keeps its chat read-only.
create type public.team_status as enum ('active', 'ended');

create type public.channel_type as enum ('team', 'age_group', 'coaches', 'academy_wide', 'direct');

create type public.channel_status as enum ('active', 'archived');

-- open         everyone posts
-- hosts_only   broadcast; members may still react
-- replies_only members may reply in a thread but not start one
create type public.posting_mode as enum ('open', 'hosts_only', 'replies_only');

create type public.channel_member_role as enum ('host', 'co_host', 'member');

-- 'pending' is the coach-approval queue.
create type public.message_status as enum ('published', 'pending', 'rejected');

create type public.event_type as enum ('match', 'training', 'social', 'other');

create type public.rsvp_status as enum ('yes', 'no', 'maybe');

create type public.poll_type as enum ('simple', 'availability');

-- Academy-level safeguarding switches.
create type public.dm_policy as enum ('staff_only', 'open');
create type public.directory_visibility as enum ('staff_only', 'all');

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Supabase stores auth.users.phone without a leading '+'; we keep true E.164.
create or replace function public.normalise_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when p_phone is null or btrim(p_phone) = '' then null
    when btrim(p_phone) like '+%' then btrim(p_phone)
    else '+' || btrim(p_phone)
  end;
$$;

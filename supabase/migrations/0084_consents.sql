-- 0084: what the family agreed to, and WHICH VERSION of it.
--
-- "They accepted the code of conduct" is worthless on its own. The question
-- that gets asked — by a parent, by an insurer, by a governing body after an
-- incident — is "what did it say when they accepted it", and an academy that
-- edited the document in place cannot answer. So documents are VERSIONED and
-- an acceptance points at a version, not at a document.
--
-- A version is immutable once anybody has accepted it. Editing published text
-- under an existing signature is the whole failure this table exists to
-- prevent, so a trigger refuses it rather than trusting everyone to remember.
--
-- NO IP ADDRESS AND NO USER AGENT. They are the reflex fields for a consent
-- log and they are the wrong call here. Data minimisation is an obligation
-- rather than a preference, we would never actually use either one, and an IP
-- address is personal information about a parent that we would then be
-- holding, and breaching, for nothing. What matters is who, what version, and
-- when — all three of which are in the row.

do $$ begin
  create type public.consent_kind as enum (
    'code_of_conduct',
    'photo_media',       -- permission to photograph and publish
    'medical_treatment', -- consent to seek treatment in an emergency
    'transport',
    'privacy',
    'terms',
    'other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.consent_documents (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  kind        public.consent_kind not null,
  title       text not null check (btrim(title) <> ''),
  -- Monotonic per document. Version 1 is the first published text.
  version     integer not null default 1 check (version > 0),
  body        text not null check (btrim(body) <> ''),
  -- Some consents are not optional: an academy cannot run without a code of
  -- conduct being accepted. Others, notably photography, MUST be refusable or
  -- the consent is not consent.
  required    boolean not null default false,
  published_at timestamptz,
  retired_at   timestamptz,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint consent_documents_id_academy_key unique (id, academy_id),
  -- One live version number per kind per academy.
  constraint consent_documents_version_key unique (academy_id, kind, version)
);

create table if not exists public.consent_acceptances (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  document_id uuid not null,
  -- The adult who accepted. Children have no accounts, so a consent is always
  -- given by a guardian.
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Which child it is about. Null means it is about the adult themselves,
  -- which is what a coach's code of conduct is.
  player_id  uuid,

  -- Photography has to be refusable, so an acceptance records the ANSWER
  -- rather than merely existing. A row with accepted = false is a family
  -- saying no, and is as important to keep as a yes — more so, because it is
  -- the one somebody has to honour.
  accepted   boolean not null,
  accepted_at timestamptz not null default now(),

  constraint consent_acceptances_id_academy_key unique (id, academy_id),
  -- One answer per document version per person per child. Changing your mind
  -- updates the row; it does not add a second opinion.
  constraint consent_acceptances_once
    unique nulls not distinct (document_id, profile_id, player_id),
  constraint consent_acceptances_document_fkey foreign key (document_id, academy_id)
    references public.consent_documents (id, academy_id) on delete cascade,
  constraint consent_acceptances_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);

create index if not exists consent_acceptances_player_idx
  on public.consent_acceptances (player_id);
create index if not exists consent_documents_academy_kind_idx
  on public.consent_documents (academy_id, kind, published_at desc);

/**
 * Published text that somebody has signed cannot be edited.
 *
 * This is the point of versioning, and versioning only works if something
 * enforces it. An academy correcting a typo in a code of conduct that two
 * hundred families have accepted would silently change what all two hundred
 * agreed to, and nothing in the row would show it had happened.
 *
 * The answer is a new version, which is cheap. Title, `required` and
 * `retired_at` stay editable — none of them changes what was agreed.
 */
create or replace function public.guard_consent_document_edit()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.body <> old.body or new.kind <> old.kind or new.version <> old.version then
    if exists (select 1 from public.consent_acceptances where document_id = old.id) then
      raise exception
        'that text has already been accepted — publish a new version instead of changing version %',
        old.version
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists consent_documents_guard on public.consent_documents;
create trigger consent_documents_guard
  before update on public.consent_documents
  for each row execute function public.guard_consent_document_edit();

create trigger consent_documents_set_updated_at
  before update on public.consent_documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- policies

alter table public.consent_documents enable row level security;
alter table public.consent_acceptances enable row level security;

-- Unpublished text is a draft. Published text is readable by the whole
-- academy, because a family must be able to re-read what they agreed to —
-- a consent you cannot look up again is not much of a consent.
create policy consent_documents_select on public.consent_documents
  for select to authenticated
  using (
    (select app_private.is_academy_member(academy_id))
    and (published_at is not null or (select app_private.is_academy_staff(academy_id)))
  );

create policy consent_documents_insert on public.consent_documents
  for insert to authenticated
  with check ((select app_private.is_academy_staff(academy_id)));

create policy consent_documents_update on public.consent_documents
  for update to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

create policy consent_documents_delete on public.consent_documents
  for delete to authenticated
  using (
    (select app_private.is_academy_staff(academy_id))
    -- Deleting a document deletes the record of everyone who accepted it.
    --
    -- `consent_documents.id` spelled out in full, not bare `id`:
    -- consent_acceptances has an `id` of its own, so inside this subquery the
    -- inner scope wins and `a.document_id = id` compares a row to itself.
    -- That is never true, the guard never fires, and every delete is allowed
    -- — a policy that reads as protection and is not.
    and not exists (
      select 1 from public.consent_acceptances a
       where a.document_id = consent_documents.id
    )
  );

create policy consent_acceptances_select on public.consent_acceptances
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (player_id is not null and (select app_private.is_guardian_of(player_id)))
    or (select app_private.is_academy_staff(academy_id))
  );

-- You accept for yourself, about your own child. Nobody accepts on a
-- family's behalf — not a coach, not an owner. That is the one thing a
-- consent record must be able to promise.
create policy consent_acceptances_insert on public.consent_acceptances
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select app_private.is_academy_member(academy_id))
    and (player_id is null or (select app_private.is_guardian_of(player_id)))
  );

create policy consent_acceptances_update on public.consent_acceptances
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Withdrawing consent is an UPDATE to accepted = false, which keeps the
-- record. Deleting the row would erase the fact that it was ever given, and
-- an academy that cannot show what was agreed is back where it started.
create policy consent_acceptances_delete on public.consent_acceptances
  for delete to authenticated
  using (false);

/**
 * What this family still has to agree to before a child can play.
 *
 * Every published, required document of this academy that this guardian has
 * not answered for this child. The registration screen asks for exactly
 * these, and nothing asks twice.
 */
create or replace function public.outstanding_consents(p_player uuid)
returns table (
  document_id uuid,
  kind        public.consent_kind,
  title       text,
  body        text,
  version     integer,
  required    boolean
)
language sql stable security definer set search_path = public as $fn$
  select d.id, d.kind, d.title, d.body, d.version, d.required
    from public.players pl
    join public.consent_documents d
      on d.academy_id = pl.academy_id
     and d.published_at is not null
     and d.retired_at is null
   where pl.id = p_player
     and (select app_private.is_guardian_of(p_player))
     and not exists (
       select 1 from public.consent_acceptances a
        where a.document_id = d.id
          and a.profile_id = auth.uid()
          and a.player_id = pl.id
     )
   order by d.required desc, d.title;
$fn$;

revoke execute on function public.outstanding_consents(uuid) from public, anon;
grant execute on function public.outstanding_consents(uuid) to authenticated;

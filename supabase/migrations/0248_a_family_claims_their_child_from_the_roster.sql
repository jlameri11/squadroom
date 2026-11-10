-- 0248: a family claims their child from the roster.
--
-- Big Club Mode item 5 (Joey, 9 Nov 2026): guardians stay out of the bulk
-- import — "contacts are picked, never synced" — so the 1,500 families of
-- an imported roster come in one at a time, through the squad's link, code
-- or QR, and are approved. What was missing: the join form asked for the
-- children's NAMES only, and approval matched a name within the team or
-- made a new player — so a club that had just imported its whole roster got
-- a duplicate child for every family whose spelling differed, and a family
-- joining through the club-wide link got a child attached to no squad.
--
-- Now a family gives each child's name AND date of birth, and approval
-- finds the child already on the roster by both (anywhere in the club: the
-- same name and birthday in one club is the same child), puts them on the
-- link's squad if they had none, and only then makes a new record. The
-- matching is the approve route's (service role); this is the column.
alter table public.join_requests
  add column if not exists children jsonb not null default '[]'::jsonb;
alter table public.join_requests
  drop constraint if exists join_requests_children_shape;
alter table public.join_requests
  add constraint join_requests_children_shape check (jsonb_typeof(children) = 'array');
comment on column public.join_requests.children is
  'The children a family named when asking to join: [{name, dob}]. children_names keeps the names for the screens that read it.';

# Squadroom

Multi-tenant group chat, fixtures and RSVPs for youth football academies.
One deployment serves every academy; tenants are isolated by row-level
security, not by separate databases or separate builds.

## Status

Phase 0 complete: schema, RLS, seed data and the isolation test suite.
No application UI yet — `design/prototype.html` is a click-through of the
six core screens, published as an Artifact.

## Stack

Next.js 16 (App Router) · Supabase (Postgres 17, Auth, Realtime, Storage) ·
Tailwind · Netlify. Built client-first so it wraps cleanly with Capacitor
later: all authorisation lives in the database, so a native shell talking to
the same API is subject to exactly the same rules.

## Environments

| | Project | Region |
|---|---|---|
| dev | `squadroom-dev` (`rnykncrdcywmetuvslvw`) | ap-southeast-2 (Sydney) |
| prod | not yet created | ap-southeast-2 |

Sydney is deliberate and permanent: Australian children's data, Australian
users, and a chat app where latency is felt. A Supabase project's region
cannot be changed after creation.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in from the Supabase dashboard
npm run dev
```

## Database

Migrations are plain SQL in `supabase/migrations`, applied in filename order.
Nothing is ever changed through the dashboard.

```bash
npx supabase link --project-ref rnykncrdcywmetuvslvw
npx supabase db push                      # apply migrations
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
psql "$SUPABASE_DB_URL" -f scripts/test-rls.sql
```

`scripts/test-rls.sql` is the one that matters. It impersonates real users —
a parent, a coach, a member of a second academy — and asserts 23 properties
of the permission model, including that a member of academy A cannot read
academy B's messages. It is idempotent; run it after every migration.

### How isolation actually works

- Every table carries `academy_id`, and every child table points at
  `(id, academy_id)` on its parent with a **composite foreign key**. A row
  that straddles two academies cannot be written, with no trigger to maintain.
- Policies are built from `STABLE SECURITY DEFINER` helpers in the
  **`app_private` schema**, which PostgREST does not expose — so they are
  callable from a policy but have no HTTP route. Policies call them as
  `(select fn(...))` so Postgres evaluates them once per statement rather
  than once per row.
- Two things RLS cannot express are handled outside it, because a policy
  grants a **row**, never a **column**:
  - **Phone numbers** — table-level SELECT on `profiles` is revoked and
    re-granted column by column; numbers come only from
    `member_directory()`, which applies the academy's visibility setting.
  - **Deleted messages** — deleting moves the body to
    `deleted_message_archive` (owners/admins, 90 days) and leaves a real
    tombstone. A soft-delete flag alone would leave the body readable
    straight from the API, whatever the UI drew.

## Layout

```
app/                     Next.js App Router
design/prototype.html    Click-through UI prototype
supabase/migrations/     0001-0017, applied in order
supabase/seed.sql        Two academies, so isolation has something to prove
scripts/test-rls.sql     23 assertions against the permission model
```

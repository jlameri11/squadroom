@AGENTS.md

# Squadroom

Multi-tenant group chat, fixtures and RSVPs for youth football academies.
NRIFA (Sydney) is the first customer; the product is multi-academy from day
one and is meant to reach hundreds of academies.

## Decisions already made — do not relitigate

- **Client-first architecture.** All authorisation lives in the database, not
  in server components or route handlers. This is what keeps a Capacitor
  native build viable later: the same API, subject to the same rules.
- **Shared schema, isolated by RLS.** Never schema-per-tenant. Every table
  carries `academy_id`; child tables use composite foreign keys against
  `(id, academy_id)` so a cross-tenant row cannot be written.
- **RLS helpers live in `app_private`**, which PostgREST does not expose.
  Never define one in `public` — that publishes it as a REST endpoint.
  Policies call them as `(select fn(...))` for per-statement evaluation.
- **Region is ap-southeast-2 (Sydney), permanently.** Australian children's
  data. A Supabase project's region cannot be changed after creation.
- **One deployment serves every academy.** Branding is data
  (`academies.primary_colour`, `logo_url`), never a per-tenant build.
- **Safeguarding defaults are the restrictive ones.** Parent-to-parent DMs
  off, parent phone numbers staff-only. Both are per-academy settings.
- **Payments use Stripe Connect Express** — money goes from parent straight
  to the academy. Squadroom never holds it. Card data never touches our
  servers. Platform billing (`academies.plan`) is a separate concern from
  academy collections; do not share a code path between them.

## Phases

0. Foundations — schema, RLS, seed, isolation tests **(done)**
1. Auth + onboarding: phone OTP, invite chain, `/join/<token>`
2. Admin console: teams, members, bulk invite
3. Chat: channels, realtime, hosts, posting modes, reactions
4. Events, RSVPs, event cards in chat, reminders
5. Polls (simple + availability), directory
6. PWA + push + super-admin console
7. Payments — Stripe Connect Express, tournament fees
8. Capacitor native wrap

## Working notes

- Migrations are SQL files in `supabase/migrations`, never dashboard changes.
- Run `scripts/test-rls.sql` after every migration. It is idempotent.
- Supabase Realtime uses `postgres_changes` behind a single
  `useChannelMessages` hook. It does not scale — it re-evaluates RLS per
  subscriber per change. Swap it for broadcast-from-trigger before onboarding
  roughly the twentieth academy. Keep the hook the only place that knows.
- Dev SMS uses Supabase test phone numbers. Real Twilio is prod only.

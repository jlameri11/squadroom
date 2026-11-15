// Run: node scripts/local-db/serve.mjs
//
// Holds the local Postgres (.local-db/, built by run.mjs) up on :54329 until
// Ctrl-C, so several queries (scripts/simulation/q.mjs, the simulation's
// stack.mjs --serve, psql) can share one server instead of each starting
// and stopping it. Never connects to Supabase.
import { join } from 'node:path'

const ROOT = process.cwd()
const { default: EmbeddedPostgres } = await import('embedded-postgres').catch(() => {
  console.log('  embedded-postgres is not installed — see scripts/local-db/run.mjs')
  process.exit(2)
})
const pg = new EmbeddedPostgres({ databaseDir: join(ROOT, '.local-db'), user: 'postgres', password: 'local', port: 54329, persistent: true, onLog: () => {}, onError: () => {} })
await pg.start()
console.log('  local Postgres up on :54329 (squadroom_local) — Ctrl-C to stop')
let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await pg.stop().catch(() => null)
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await new Promise(() => {})

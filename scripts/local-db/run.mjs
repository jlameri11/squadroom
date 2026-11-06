// Run: node scripts/local-db/run.mjs [--until 0207] [--keep] [--from 0208] [--seed] [--rls]
//
// Every migration, applied in order to a throwaway local Postgres — for the
// days the Supabase access token is dead (NEEDS JOEY #12) and migrations
// pile up unapplied. A parser (pglast) says a migration is well formed; this
// says it RUNS: every column it names exists, every function it calls takes
// those arguments, every policy compiles against the schema the earlier
// migrations built.
//
// Needs the embedded Postgres package, which is not a dependency of the app
// (it is a 30 MB binary). Once, per machine:
//     npm i --no-save embedded-postgres@17.11.0-beta.19
//
// What it does:
//   1. starts Postgres 17 in .local-db/ on port 54329 (a fresh database
//      each run unless --keep);
//   2. applies scripts/local-db/supabase-stubs.sql — the auth, storage,
//      realtime, pg_cron and pg_net pieces Supabase provides, by shape only;
//   3. applies supabase/migrations/*.sql in the order scripts/migrate.mjs
//      uses, each in its own transaction, stopping at the first failure
//      with its error and line;
//   4. --seed: loads supabase/seed.sql (the demo's people and teams);
//   5. --rls: runs scripts/test-rls.sql and prints its verdicts — against the
//      seed only, not the full demo, so checks that need demo data refresh-
//      demo added (competitions, chats) may not apply.
//
// It never connects to Supabase. Nothing here touches squadroom-dev.
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null
// --until 0207: stop after this version — where squadroom-dev is today, so
// copy-dev.mjs can bring its rows in and the pending migrations then run on
// top of them, backfills and all, as they will on token day.
const until = args.includes('--until') ? args[args.indexOf('--until') + 1] : null
const ROOT = process.cwd()
const DATA = join(ROOT, '.local-db')
const PORT = 54329
const DB = 'squadroom_local'
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

let EmbeddedPostgres
try {
  ;({ default: EmbeddedPostgres } = await import('embedded-postgres'))
} catch {
  console.log(red('  embedded-postgres is not installed.'))
  console.log('  Once, per machine:  npm i --no-save embedded-postgres@17.11.0-beta.19')
  process.exit(2)
}

if (!flag('--keep') && existsSync(DATA)) rmSync(DATA, { recursive: true, force: true })
const pg = new EmbeddedPostgres({ databaseDir: DATA, user: 'postgres', password: 'local', port: PORT, persistent: true, onLog: () => {}, onError: () => {} })
if (!existsSync(join(DATA, 'PG_VERSION'))) await pg.initialise()
await pg.start()

let failed = false
try {
  if (!flag('--keep')) {
    await pg.dropDatabase(DB).catch(() => {})
    await pg.createDatabase(DB)
  }
  const client = pg.getPgClient(DB)
  await client.connect()
  const run = async (label, sql) => {
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('commit')
      return null
    } catch (e) {
      await client.query('rollback').catch(() => {})
      return e
    }
  }

  if (!flag('--keep')) {
    const stubErr = await run('stubs', readFileSync(join(ROOT, 'scripts/local-db/supabase-stubs.sql'), 'utf8'))
    if (stubErr) throw new Error(`the stand-ins failed: ${stubErr.message}`)
  }

  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
  const done = new Set((await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version))
  let applied = 0
  for (const file of files) {
    const version = file.match(/^(\d+[a-z]?)_/)?.[1]
    if (!version || done.has(version)) continue
    if (until && version > until) break
    if (from && version < from && flag('--keep')) continue
    // pg_cron and pg_net are Supabase's; their stand-ins are in the stubs.
    const sql = readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8')
      .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '-- local: $1 stood in by supabase-stubs.sql')
    const t = Date.now()
    const err = await run(file, sql)
    if (err) {
      failed = true
      const at = err.position ? sql.slice(0, Number(err.position)).split('\n').length : null
      console.log(red(`  ✗ ${file}`) + `${at ? ` (line ${at})` : ''}: ${err.message}`)
      if (err.where) console.log(dim(`      ${err.where.split('\n')[0]}`))
      break
    }
    await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict do nothing', [version, file])
    // On Supabase the extensions (citext, pg_trgm…) belong to supabase_admin,
    // so a migration's sweep of public's functions cannot revoke theirs —
    // 0015 tried, and was a no-op there. Here postgres owns them and the
    // revoke works, which breaks citext's operators for everyone; give it back.
    await client.query(`do $$ declare r record; begin
      for r in select p.oid::regprocedure as sig from pg_proc p
                 join pg_depend d on d.objid = p.oid and d.deptype = 'e'
                 join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
      loop execute format('grant execute on function %s to public', r.sig); end loop;
    end $$`)
    applied += 1
    if (from && version >= from) console.log(green(`  ✓ ${file}`) + dim(` ${Date.now() - t} ms`))
  }
  if (!failed) console.log(green(until ? `  migrations up to ${until} apply (${applied} this run)` : `  all ${files.length} migrations apply (${applied} this run)`))

  if (!failed && flag('--seed')) {
    const err = await run('seed', readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8'))
    if (err) {
      failed = true
      console.log(red(`  ✗ seed.sql: ${err.message}`))
    } else console.log(green('  seed.sql loads'))
  }

  if (!failed && flag('--rls')) {
    const sql = readFileSync(join(ROOT, 'scripts/test-rls.sql'), 'utf8')
    const parts = sql.split(/^select \* from rls_results order by n;\s*$/m)
    await client.query(parts[0]).catch((e) => {
      failed = true
      console.log(red(`  ✗ test-rls.sql stopped: ${e.message}`))
      if (e.where) console.log(dim(`      ${e.where.split('\n')[0]}`))
    })
    if (!failed) {
      const { rows } = await client.query('select n, check_name, result from rls_results order by n')
      const bad = rows.filter((r) => !r.result.startsWith('PASS'))
      for (const r of rows) console.log(`  ${r.result.startsWith('PASS') ? green('✓') : red('✗')} ${String(r.n).padStart(3)} ${r.check_name}${r.result.startsWith('PASS') ? '' : dim(` — ${r.result}`)}`)
      console.log(bad.length ? red(`\n  ${bad.length} of ${rows.length} checks not passing`) : green(`\n  all ${rows.length} checks pass`))
      if (bad.length) failed = true
    }
  }
  await client.end()
} finally {
  if (!flag('--keep-running')) await pg.stop()
}
process.exitCode = failed ? 1 : 0

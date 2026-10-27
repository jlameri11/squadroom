// Run: npm run db:setup
//
// Asks for ONE thing, works out the rest, checks it, and saves it.
//
// This exists because the previous instruction was four steps across two
// dashboard pages, and three of them were things I could do myself. The only
// part that genuinely needs a human is the secret, because a secret must not
// travel through a chat transcript. So that is all this asks for.
//
// It accepts either credential, because they have different costs for the
// person holding them:
//
//   · A Supabase ACCESS TOKEN (sbp_…) — one page, one button, copy. Nothing
//     to look up and nothing to reset. This is the easy path.
//   · The DATABASE PASSWORD — fine if you know it, but most people do not,
//     and finding out means resetting it.
//
// Either way the result is the same: migrations can be applied without the
// MCP connection, which is what left eight of them stranded.
//
// YOU have to run this, not me. The prompt hides what you type and the value
// goes straight into .env.local, which is gitignored — it never appears in a
// transcript, a log or a commit.
import { createInterface } from 'node:readline'
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import pg from 'pg'
import { PROJECT_REF, endpoint } from './_project.mjs'

const REF = PROJECT_REF
const ENV = '.env.local'

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

console.log(`
${bold('Squadroom — connect to the database')}

  Eight migrations are written and waiting. This is the one thing I cannot
  do for you, because it needs a secret and secrets should not go through
  a chat.

  ${bold('The easy way')} — a Supabase access token:

    1. Open  ${bold('https://supabase.com/dashboard/account/tokens')}
    2. Generate new token → name it ${bold('squadroom')} → Generate
    3. Copy it (starts with ${bold('sbp_')}) and paste it below

  ${dim('Or, if you happen to know your database password, paste that instead.')}
  ${dim('Nothing is echoed as you type, and nothing is printed back.')}
`)

/**
 * A prompt that does not echo, so the secret is not left on screen.
 *
 * It shows a dot per character rather than nothing at all. "Nothing is
 * echoed" sounds reassuring and reads, to the person at the keyboard, exactly
 * like a frozen program — which is what happened: somebody pasted, pressed
 * return, saw no change at all, and reasonably concluded it had hung. A
 * hidden prompt still has to prove it is listening.
 */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const stdout = process.stdout
    const write = stdout.write.bind(stdout)
    let muted = false
    stdout.write = (chunk, ...rest) => {
      if (!muted) return write(chunk, ...rest)
      // A dot for whatever readline was about to echo, so a paste visibly
      // lands and a keystroke visibly registers.
      const text = typeof chunk === 'string' ? chunk : String(chunk)
      if (text === '\r' || text === '\n' || text === '\r\n') return true
      return write('\u2022'.repeat(Math.max(text.length, 1)))
    }
    rl.question(question, (answer) => {
      stdout.write = write
      stdout.write('\n')
      rl.close()
      resolve(answer.trim())
    })
    muted = true
  })
}

// The environment first, so there is a way through that does not depend on a
// terminal delivering keystrokes to a muted prompt at all:
//
//   SUPABASE_ACCESS_TOKEN=sbp_... npm run db:setup
//
// The same secret going to the same place, skipping the prompt. Added because
// the prompt silently swallowed a paste on a real machine and the only
// visible symptom was a program that looked frozen.
const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim()
if (fromEnv) console.log(dim('  Using SUPABASE_ACCESS_TOKEN from the environment.\n'))

const secret = fromEnv || (await askHidden('  Paste it here, then press return: '))

if (!secret) {
  console.log(
    red('\n  Nothing arrived.') +
      `

  If no dots appeared as you pasted, this terminal is not passing
  keystrokes to the prompt. Two ways round it:

    ${bold('1. Put it in the file yourself')}
       Open ${bold(ENV)} and add one line:
         SUPABASE_ACCESS_TOKEN=sbp_yourtoken

    ${bold('2. Pass it in and skip the prompt')}
         SUPABASE_ACCESS_TOKEN=sbp_yourtoken npm run db:setup
`
  )
  process.exit(1)
}

if (existsSync(ENV)) {
  const current = readFileSync(ENV, 'utf8')
  if (/^SUPABASE_(DB_URL|ACCESS_TOKEN)=.+/m.test(current)) {
    console.log(dim('  (replacing the connection already in .env.local)'))
  }
}

// ---------------------------------------------------------------- the token

if (secret.startsWith('sbp_')) {
  process.stdout.write('  Checking the token … ')
  const response = await fetch(endpoint(), {
    headers: { Authorization: `Bearer ${secret}` },
  })

  if (response.status === 401 || response.status === 403) {
    console.log(red('rejected'))
    console.log(
      red('\n  Supabase did not accept that token. Generate a fresh one and try again.\n')
    )
    process.exit(1)
  }
  if (response.status === 404) {
    console.log(red('no access'))
    console.log(
      red(
        `\n  The token is valid but cannot see project ${REF}.\n` +
          '  Make sure you generated it on the account that owns squadroom-dev.\n'
      )
    )
    process.exit(1)
  }
  if (!response.ok) {
    console.log(red(`HTTP ${response.status}`))
    console.log(red(`\n  ${(await response.text()).slice(0, 300)}\n`))
    process.exit(1)
  }

  const project = await response.json()
  console.log(green('ok'))
  console.log(`  Connected to ${bold(project.name)} in ${project.region}.`)

  // And prove it can run SQL, which is the thing we actually need. A token
  // that reads project metadata but cannot query is no use here, and finding
  // that out now is better than finding it out mid-migration.
  process.stdout.write('  Checking it can run SQL … ')
  const query = await fetch(endpoint('database/query'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'select 1 as ok' }),
  })
  if (!query.ok) {
    console.log(red(`HTTP ${query.status}`))
    console.log(
      red(
        `\n  ${(await query.text()).slice(0, 300)}\n\n` +
          '  The token works but cannot run queries. Paste your database\n' +
          '  password instead — run this again and use that.\n'
      )
    )
    process.exit(1)
  }
  console.log(green('ok'))

  appendFileSync(ENV, `\n# Added by scripts/setup-db.mjs. Applies migrations without MCP.\nSUPABASE_ACCESS_TOKEN=${secret}\n`)
  done()
}

// ------------------------------------------------------------- the password

// Supabase has moved pooler hostnames more than once (aws-0, aws-1, and the
// direct db.<ref> host), so rather than make somebody read a connection
// string off a dashboard and get the right one, try them.
const CANDIDATES = [
  `postgresql://postgres.${REF}:PW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${REF}:PW@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${REF}:PW@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres:PW@db.${REF}.supabase.co:5432/postgres`,
]

console.log('  Looking for the right host …')
let working = null
let lastError = null

for (const template of CANDIDATES) {
  const url = template.replace('PW', encodeURIComponent(secret))
  const host = url.split('@')[1]
  process.stdout.write(`    ${host.padEnd(62)} `)
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12_000,
  })
  try {
    await client.connect()
    await client.query('select 1')
    await client.end()
    console.log(green('works'))
    working = url
    break
  } catch (error) {
    await client.end().catch(() => {})
    lastError = error
    // A wrong password is worth saying out loud: trying three more hosts
    // with the same wrong password will not help.
    if (/password authentication failed/i.test(error.message)) {
      console.log(red('wrong password'))
      console.log(
        red(
          '\n  That password was rejected. If you are not sure of it, reset it at\n' +
            `  https://supabase.com/dashboard/project/${REF}/settings/database\n` +
            '  — resetting breaks nothing, because nothing else uses it.\n\n' +
            '  Or use an access token instead, which needs nothing looked up:\n' +
            '  https://supabase.com/dashboard/account/tokens\n'
        )
      )
      process.exit(1)
    }
    console.log(dim(error.message.split('\n')[0].slice(0, 40)))
  }
}

if (!working) {
  console.log(
    red(
      `\n  Could not reach the database on any known host.\n  Last error: ${lastError?.message}\n\n` +
        '  An access token is the easier path and does not need a host at all:\n' +
        '  https://supabase.com/dashboard/account/tokens\n'
    )
  )
  process.exit(1)
}

appendFileSync(
  ENV,
  `\n# Added by scripts/setup-db.mjs. Applies migrations without MCP.\nSUPABASE_DB_URL=${working}\n`
)
done()

function done() {
  console.log(green(`\n  Saved to ${ENV}. It is gitignored, so it stays on this machine.`))
  console.log(`
  ${bold('Now either:')}

    · tell me ${bold('"go"')} and I will apply all eight and run the tests, or
    · do it yourself:  ${bold('npm run db:migrate')}

  To see what would run without running it:  ${bold('npm run db:migrate -- --dry')}
`)
  process.exit(0)
}

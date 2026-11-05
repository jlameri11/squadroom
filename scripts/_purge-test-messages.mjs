/**
 * A suite's own messages, gone for good — including the ones it deleted the
 * way a person would.
 *
 * Deleting a message through the app blanks it in `messages` (a tombstone,
 * "Message deleted") and keeps its words in `deleted_message_archive` for
 * the safeguarding officer (0012). Suites cleaned up by matching their tag in
 * `messages.body`, which a tombstone no longer has — so every run left its
 * deleted test messages behind, and by 5 Nov 2026 the demo's U8 SPL chat was
 * 113 "Message deleted" bubbles out of 161 messages.
 *
 * This finds a suite's messages by their tag in either place, and removes
 * the message and its archive row. Only ever called with a suite's own tag.
 */
export async function purgeTestMessages(admin, prefixes) {
  const ids = new Set()
  for (const p of prefixes) {
    const { data: live } = await admin.from('messages').select('id').like('body', `${p}%`)
    for (const m of live ?? []) ids.add(m.id)
    const { data: gone } = await admin.from('deleted_message_archive').select('message_id').like('body', `${p}%`)
    for (const m of gone ?? []) ids.add(m.message_id)
  }
  const list = [...ids]
  const errors = []
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    const { error: m } = await admin.from('messages').delete().in('id', chunk)
    if (m) errors.push(m.message)
    const { error: a } = await admin.from('deleted_message_archive').delete().in('message_id', chunk)
    if (a) errors.push(a.message)
  }
  return { purged: list.length, errors }
}

// node --env-file=.env.local scripts/_purge-test-messages.mjs PREFIX [PREFIX…]
if (process.argv[1]?.endsWith('_purge-test-messages.mjs') && process.argv.length > 2) {
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const out = await purgeTestMessages(admin, process.argv.slice(2))
  console.log(`purged ${out.purged}${out.errors.length ? ` — errors: ${[...new Set(out.errors)].join('; ')}` : ''}`)
}

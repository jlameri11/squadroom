'use client'

import { createClient } from '@/lib/supabase/client'
import { batched } from '@/lib/batch'

/**
 * Signed links to the chat's private files, made once and kept for this tab.
 *
 * The attachments bucket is private, so every photo, voice note and PDF is
 * shown through a link that expires in an hour (attachments.tsx says why).
 * Making the links was the slowest single request on the chat screen — about
 * 650 ms — and it was made again on every visit, though each link lasts an
 * hour (time-screens, 6 Nov 2026). Now:
 *
 *   · the links asked for in the same moment are one request (lib/batch.ts);
 *   · a link is kept, in memory and in this tab's sessionStorage, until it
 *     has five minutes left — then made again;
 *   · signing out forgets them all (sign-out.tsx), so a link one person was
 *     given is not on the device for the next.
 */
const BUCKET = 'attachments'
const LIFE_S = 3600
const KEEP_KEY = 'squadroom.signed'
const MARGIN_MS = 5 * 60e3
const MAX_KEPT = 400

type Kept = Record<string, { url: string; until: number }>
const memory: Kept = {}

function readKept(): Kept {
  try {
    return JSON.parse(sessionStorage.getItem(KEEP_KEY) ?? '{}') as Kept
  } catch {
    return {}
  }
}

function keep(path: string, url: string) {
  const entry = { url, until: Date.now() + LIFE_S * 1000 }
  memory[path] = entry
  try {
    const all = readKept()
    all[path] = entry
    const now = Date.now()
    const live = Object.entries(all)
      .filter(([, e]) => e.until - now > MARGIN_MS)
      .sort((a, b) => b[1].until - a[1].until)
      .slice(0, MAX_KEPT)
    sessionStorage.setItem(KEEP_KEY, JSON.stringify(Object.fromEntries(live)))
  } catch {
    // A private window keeps nothing; the link is still made.
  }
}

const signMany = batched<string, string>(async (paths) => {
  const { data } = await createClient().storage.from(BUCKET).createSignedUrls(paths, LIFE_S)
  const map = new Map<string, string>()
  for (const row of data ?? []) if (row.path && row.signedUrl) map.set(row.path, row.signedUrl)
  return map
})

/** A link to show `path` with, from what this tab already has or freshly made. */
export async function signedLink(path: string): Promise<string | undefined> {
  const now = Date.now()
  const hit = memory[path] ?? readKept()[path]
  if (hit && hit.until - now > MARGIN_MS) {
    memory[path] = hit
    return hit.url
  }
  const url = await signMany(path)
  if (url) keep(path, url)
  return url
}

/** Signing out: nobody else's links stay on the device. */
export function forgetSignedLinks() {
  for (const k of Object.keys(memory)) delete memory[k]
  try {
    sessionStorage.removeItem(KEEP_KEY)
  } catch {
    // Nothing kept.
  }
}

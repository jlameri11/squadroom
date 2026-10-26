'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Item = {
  kind: string
  title: string
  detail: string | null
  href: string
  count: number
  urgent: boolean
}

/**
 * The things waiting on this person, at the top of the home screen.
 *
 * Not navigation — the tab bar is five destinations and stays five. This is
 * the specific work outstanding right now, each row a link to where it is
 * dealt with.
 *
 * It exists because an audit of the navigation found that `/payments` and
 * `/programs` were linked from NOWHERE. A parent could not find their bills
 * and could not find anything to sign up to: two whole features invisible to
 * the only people who use them. A strip of prompts fixes that without adding
 * a sixth tab or turning the home screen into a menu.
 *
 * NOTHING WHEN THERE IS NOTHING. A strip that renders "0 outstanding" is a
 * strip that is always there, and the home screen is worth more when most
 * people see none of this.
 */
export function NeedsYou() {
  const [items, setItems] = useState<Item[] | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      // `?? undefined`, because getOrg returns null for "no preference" and
      // the generated signature takes an optional uuid rather than a
      // nullable one.
      const { data } = await createClient().rpc('needs_you', {
        p_academy: getOrg() ?? undefined,
      })
      if (!live) return
      setItems((data ?? []) as Item[])
    })()
    return () => {
      live = false
    }
  }, [])

  if (!items || items.length === 0) return null

  // Money and consents first, because they have deadlines; the database
  // already orders them, so this only separates the two groups visually.
  const urgent = items.filter((i) => i.urgent)
  const rest = items.filter((i) => !i.urgent)

  return (
    <section className="px-4 pb-1 pt-4">
      <h2 className="eyebrow px-1 pb-2">Needs you</h2>

      <div className="flex flex-col gap-2">
        {urgent.map((i) => (
          <Link
            key={i.kind}
            href={i.href}
            className="flex items-center gap-3 rounded-[14px] p-3.5 text-sm text-white"
            style={{ background: 'var(--accent)', boxShadow: 'var(--shadow)' }}
          >
            <span className="display grid h-8 w-8 flex-none place-items-center rounded-full bg-white/25 text-base">
              {i.count}
            </span>
            <span className="min-w-0">
              <b className="block truncate">{i.title}</b>
              {i.detail && <span className="block truncate opacity-90">{i.detail}</span>}
            </span>
            <span className="ml-auto flex-none text-lg opacity-80">›</span>
          </Link>
        ))}

        {/* The quieter ones get a quieter treatment. Six red cards on one
            screen is six things nobody reads. */}
        {rest.length > 0 && (
          <ul className="card overflow-hidden">
            {rest.map((i) => (
              <li key={i.kind}>
                <Link href={i.href} className="row justify-between">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i.title}</span>
                    {i.detail && (
                      <span className="block truncate text-sm text-ink-3">{i.detail}</span>
                    )}
                  </span>
                  <span className="flex-none text-lg text-ink-3">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

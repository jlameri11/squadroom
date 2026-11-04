'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const LANGUAGES: [string, string][] = [
  ['', 'Off — read messages as written'],
  ['ar', 'العربية (Arabic)'],
  ['zh', '中文 (Chinese)'],
  ['vi', 'Tiếng Việt (Vietnamese)'],
  ['el', 'Ελληνικά (Greek)'],
  ['it', 'Italiano (Italian)'],
  ['es', 'Español (Spanish)'],
  ['pt', 'Português (Portuguese)'],
  ['ko', '한국어 (Korean)'],
  ['hi', 'हिन्दी (Hindi)'],
  ['ne', 'नेपाली (Nepali)'],
  ['fil', 'Filipino'],
  ['fa', 'فارسی (Persian)'],
  ['tr', 'Türkçe (Turkish)'],
  ['fr', 'Français (French)'],
  ['ja', '日本語 (Japanese)'],
]

/** W-08: read messages in your own language; the original is always one tap away. */
export function ChatLanguage({ initial }: { initial: string | null }) {
  const [lang, setLang] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function set(next: string) {
    setLang(next)
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_chat_language', { p_lang: next })
    setBusy(false)
    if (error) return setError(error.message)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="mt-6">
      <h2 className="font-semibold">Read messages in</h2>
      <p className="mt-0.5 text-sm text-ink-2">
        Messages show in your language, with what was actually written one tap away. Names, times and scores are kept as they are.
      </p>
      <select value={lang} disabled={busy} onChange={(e) => void set(e.target.value)} aria-label="Read messages in" className="mt-2 w-full rounded-xl border px-3 py-2.5 text-base" style={{ borderColor: 'var(--line)' }}>
        {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
      {saved && <p className="mt-1 text-xs" style={{ color: 'var(--yes)' }}>Saved</p>}
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}

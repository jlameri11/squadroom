'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Preview = { players: number; families: number; teams: number }

/**
 * "Publish teams" for the Season screen (Big Club Mode item 7; 0249).
 *
 * Rollover, moves and accepted offers put a child on a squad and used to
 * tell nobody. This counts everyone on a squad since their family was last
 * told, and sends each family one message — squad, coach, manager,
 * training, ground — with a welcome in each squad's chat. Staff and
 * coordinators only; the database decides.
 */
export function PublishTeams({ academyId }: { academyId: string }) {
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined)
  const [result, setResult] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('publish_teams_preview', { p_academy: academyId })
    setPreview((data as unknown as Preview | null) ?? null)
  }, [academyId])
  useEffect(() => {
    void load()
  }, [load])

  if (preview === undefined || preview === null) return null

  async function publish() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('publish_teams', { p_academy: academyId })
    setBusy(false)
    if (error) return setError(error.message)
    setResult(data as unknown as Preview)
    await load()
  }

  return (
    <section className="card mt-4 p-3.5" data-publish-teams-card data-to-tell={preview.players}>
      <h2 className="eyebrow pb-1.5">Publish teams</h2>
      {result && (
        <p className="mb-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }} data-published-all>
          Told {result.families} {result.families === 1 ? 'family' : 'families'} about {result.players} {result.players === 1 ? 'player' : 'players'} on {result.teams} {result.teams === 1 ? 'squad' : 'squads'}.
        </p>
      )}
      {preview.players === 0 ? (
        <p className="text-sm text-ink-2">Every family has been told their squad.</p>
      ) : (
        <>
          <p className="text-sm text-ink-2">
            <b>{preview.players}</b> {preview.players === 1 ? 'player is' : 'players are'} on a squad their family has not been told about — {preview.families} {preview.families === 1 ? 'family' : 'families'}, {preview.teams} {preview.teams === 1 ? 'squad' : 'squads'}. One message each: squad, coach, manager, training, ground; and a welcome in each squad&apos;s chat.
          </p>
          {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
          <button onClick={publish} disabled={busy} className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-publish-all>
            {busy ? 'Publishing…' : 'Publish teams'}
          </button>
        </>
      )}
    </section>
  )
}

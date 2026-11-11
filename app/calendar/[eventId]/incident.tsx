'use client'

import { useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'

type Player = { id: string; full_name: string }

/**
 * An incident or injury, reported from the ground (Big Club Mode item 11;
 * 0253). Who, what, when, what first aid was given, whether an ambulance
 * came and the parent was told. Filed by the squad's coach or manager, the
 * staff or a field marshal; read by the Welfare officer and the President,
 * who are told the moment it is filed. A head knock has its own record
 * (the concussion panel) — this does not replace it.
 */
export function ReportIncident({ eventId, academyId, teamId }: { eventId: string; academyId: string; teamId: string | null }) {
  const [open, setOpen] = useState(false)
  const [players, setPlayers] = useState<Player[]>([])
  const [playerId, setPlayerId] = useState('')
  const [who, setWho] = useState('')
  const [what, setWhat] = useState('')
  const [firstAid, setFirstAid] = useState('')
  const [ambulance, setAmbulance] = useState(false)
  const [parentTold, setParentTold] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState(false)

  useEffect(() => {
    if (!open || !teamId) return
    let live = true
    ;(async () => {
      const { data } = await createClient().from('players').select('id, full_name').eq('team_id', teamId).order('full_name')
      if (live) setPlayers((data ?? []) as Player[])
    })()
    return () => {
      live = false
    }
  }, [open, teamId])

  async function file() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('file_incident_report', {
      p_academy: academyId,
      p_what: what,
      p_event: eventId,
      p_player: (playerId || null) as unknown as string,
      p_who: (playerId ? null : who.trim() || null) as unknown as string,
      p_first_aid: (firstAid.trim() || null) as unknown as string,
      p_ambulance: ambulance,
      p_parent_told: parentTold,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setFiled(true)
  }

  const line = { borderColor: 'var(--line)' }
  return (
    <>
      <button onClick={() => setOpen(true)} className="tap mt-2 text-xs underline underline-offset-4 text-ink-2" data-report-incident>
        Report an incident or injury
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="p-4" data-incident-form>
            {filed ? (
              <div className="text-center" data-incident-filed>
                <p className="display text-[1.375rem] leading-tight">Reported</p>
                <p className="mt-1.5 text-sm text-ink-2">The Welfare officer and the President have it now. Nobody else sees it.</p>
                <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink" style={{ background: 'var(--brand)' }}>Done</button>
              </div>
            ) : (
              <>
                <h2 className="display text-[1.375rem] leading-tight">Report an incident</h2>
                <p className="mt-0.5 text-sm text-ink-2">Who, what, and what was done. Goes to the Welfare officer and the President only.</p>
                <div className="mt-3 flex flex-col gap-3">
                  {players.length > 0 && (
                    <label className="block text-sm">
                      <span className="text-ink-2">Who</span>
                      <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-incident-player>
                        <option value="">Someone else — name them below</option>
                        {players.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                    </label>
                  )}
                  {!playerId && (
                    <label className="block text-sm">
                      <span className="text-ink-2">Their name</span>
                      <input value={who} onChange={(e) => setWho(e.target.value)} maxLength={120} placeholder="A visitor, a spectator, an official" className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-incident-who />
                    </label>
                  )}
                  <label className="block text-sm">
                    <span className="text-ink-2">What happened</span>
                    <textarea value={what} onChange={(e) => setWhat(e.target.value)} rows={3} maxLength={2000} className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-incident-what />
                  </label>
                  <label className="block text-sm">
                    <span className="text-ink-2">First aid given</span>
                    <input value={firstAid} onChange={(e) => setFirstAid(e.target.value)} maxLength={1000} placeholder="Ice, elevated, walked off" className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base" style={line} data-incident-first-aid />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={ambulance} onChange={(e) => setAmbulance(e.target.checked)} className="h-4 w-4" data-incident-ambulance />
                    An ambulance was called
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={parentTold} onChange={(e) => setParentTold(e.target.checked)} className="h-4 w-4" data-incident-parent />
                    The parent has been told
                  </label>
                  <p className="text-xs text-ink-3">A knock to the head? Record a concussion on the player&apos;s card as well — it keeps them off until they are cleared.</p>
                  {error && <p className="text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
                  <button onClick={file} disabled={busy || !what.trim() || (!playerId && !who.trim())} className="w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-incident-file>
                    {busy ? 'Reporting…' : 'Report it'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Sheet>
      )}
    </>
  )
}

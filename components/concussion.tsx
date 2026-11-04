'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Concussion = {
  id: string
  occurred_on: string
  note: string | null
  status: 'active' | 'clearance_submitted' | 'cleared'
  clearance_path: string | null
  clearance_note: string | null
  clearance_uploaded_at: string | null
  cleared_at: string | null
  decision_note: string | null
}

const BUCKET = 'medical-clearances'
const day = (iso: string) => new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * W-02: a concussion, from either side of the roster.
 *
 * `role` decides what the buttons do: a parent (family) records and uploads
 * the clearance; the club (coach) records, uploads on a family's behalf,
 * and is the only one who ACCEPTS. The same component on the roster and on
 * My family, so the two never disagree about what a child's status is.
 */
export function ConcussionPanel({ playerId, academyId, role, compact = false }: { playerId: string; academyId: string; role: 'family' | 'coach'; compact?: boolean }) {
  const [rows, setRows] = useState<Concussion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [uploading, setUploading] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().from('player_concussions').select('id, occurred_on, note, status, clearance_path, clearance_note, clearance_uploaded_at, cleared_at, decision_note').eq('player_id', playerId).order('occurred_on', { ascending: false })
    if (error) return setError(error.message)
    setRows((data as Concussion[]) ?? [])
  }, [playerId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function record() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('record_concussion', { p_player: playerId, p_occurred_on: date, p_note: note || undefined })
    setBusy(false)
    if (error) return setError(error.message)
    setRecording(false)
    setNote('')
    await load()
  }

  async function upload(c: Concussion, file: File) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${academyId}/${playerId}/clearance-${Date.now()}.${ext}`
    const { error: up } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/pdf', upsert: false })
    if (up) {
      setBusy(false)
      return setError(up.message)
    }
    const { error } = await supabase.rpc('submit_concussion_clearance', { p_concussion: c.id, p_path: path })
    setBusy(false)
    if (error) return setError(error.message)
    setUploading(null)
    await load()
  }

  async function decide(c: Concussion, accept: boolean) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('decide_concussion_clearance', { p_concussion: c.id, p_accept: accept, p_note: accept ? undefined : 'The club did not accept this clearance — ask for a doctor\'s letter' })
    setBusy(false)
    if (error) return setError(error.message)
    await load()
  }

  async function openFile(c: Concussion) {
    if (!c.clearance_path) return
    const { data } = await createClient().storage.from(BUCKET).createSignedUrl(c.clearance_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!rows) return null
  const open = rows.find((r) => r.status !== 'cleared')
  const past = rows.filter((r) => r.status === 'cleared')

  return (
    <div className={compact ? 'mt-1.5' : 'mt-2'}>
      {open ? (
        <div className="rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          <b>No play — concussion {day(open.occurred_on)}.</b>{' '}
          {open.status === 'clearance_submitted' ? 'A clearance is uploaded and waiting for the club.' : 'A medical clearance must be uploaded and accepted by the club.'}
          {open.note && <span className="block text-xs opacity-80">{open.note}</span>}
          {open.decision_note && open.status === 'active' && <span className="block text-xs opacity-80">{open.decision_note}</span>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {open.clearance_path && (
              <button onClick={() => openFile(open)} className="rounded-lg border px-2 py-1" style={{ borderColor: 'currentColor' }}>Open the clearance</button>
            )}
            {open.status === 'active' && uploading !== open.id && (
              <button onClick={() => setUploading(open.id)} className="rounded-lg border px-2 py-1" style={{ borderColor: 'currentColor' }}>Upload a clearance</button>
            )}
            {uploading === open.id && (
              <input type="file" accept=".pdf,image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(open, f) }} className="text-xs" />
            )}
            {role === 'coach' && open.status === 'clearance_submitted' && (
              <>
                <button onClick={() => decide(open, true)} disabled={busy} className="rounded-lg px-2.5 py-1 font-semibold text-yes-ink disabled:opacity-50" style={{ background: 'var(--yes)' }}>Accept — cleared to play</button>
                <button onClick={() => decide(open, false)} disabled={busy} className="rounded-lg border px-2 py-1 disabled:opacity-50" style={{ borderColor: 'currentColor' }}>Not accepted</button>
              </>
            )}
            {role === 'family' && open.status === 'clearance_submitted' && <span className="opacity-80">Only the club can accept it.</span>}
          </div>
        </div>
      ) : recording ? (
        <div className="grid gap-2 rounded-lg p-2.5 text-xs" style={{ background: 'var(--surface-2)' }}>
          <label>
            <span className="text-ink-2">When</span>
            <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened (optional)" className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          <div className="flex gap-2">
            <button onClick={record} disabled={busy} className="flex-1 rounded-lg px-3 py-1.5 font-semibold text-no-ink disabled:opacity-50" style={{ background: 'var(--no)' }}>Record the concussion</button>
            <button onClick={() => setRecording(false)} className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--line)' }}>Cancel</button>
          </div>
          <p className="text-ink-3">They will be kept off every team sheet until the club accepts a medical clearance.</p>
        </div>
      ) : (
        <button onClick={() => setRecording(true)} className="text-xs underline underline-offset-2 text-ink-3">
          {past.length > 0 ? `Concussion — cleared ${day(past[0].cleared_at ?? past[0].occurred_on)} · record another` : 'Record a concussion'}
        </button>
      )}
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </div>
  )
}

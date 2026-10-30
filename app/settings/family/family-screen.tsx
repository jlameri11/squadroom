'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { SHIRT_SIZES, SOCK_SIZES } from '@/app/admin/teams/[teamId]/kit-sizes'

type Medical = {
  conditions: string | null
  allergies: string | null
  medications: string | null
  dietary: string | null
  emergency_name: string | null
  emergency_phone: string | null
  emergency_relation: string | null
  doctor_name: string | null
  doctor_phone: string | null
  first_aid_consent: boolean | null
}

type Consent = {
  document_id: string
  title: string
  kind: string
  version: number
  required: boolean
  /** null: never answered. */
  accepted: boolean | null
  accepted_at: string | null
}

type Child = {
  id: string
  academy_id: string
  club: string
  full_name: string
  preferred_name: string | null
  dob: string | null
  gender: string | null
  school: string | null
  ff_number: string | null
  official_status: 'unknown' | 'pending' | 'registered' | 'not_required'
  relationship: string | null
  kit: { shirt: string | null; shorts: string | null; socks: string | null }
  squad: { id: string; name: string; season: string | null } | null
  number: number | null
  medical: Medical | null
  consents: Consent[]
}

const EMPTY_MEDICAL: Medical = {
  conditions: null,
  allergies: null,
  medications: null,
  dietary: null,
  emergency_name: null,
  emergency_phone: null,
  emergency_relation: null,
  doctor_name: null,
  doctor_phone: null,
  first_aid_consent: null,
}

/**
 * The children this person is a guardian of, and what the club holds about
 * each — with the parts a family owns made editable.
 *
 * What a parent may change here is what a parent knows better than a club:
 * medical and emergency details, kit sizes, and their own agreements. Name,
 * date of birth and squad are the club's to change, because they are what
 * eligibility and the match sheet are built on; a wrong one is a
 * conversation with the coach, not a text box.
 *
 * Withdrawing an agreement is one tap and is RECORDED, not deleted: a
 * refusal is kept as carefully as a yes (0084), and the club's outstanding
 * list and the photo warning read it the moment it is made.
 */
export function FamilyScreen() {
  const [children, setChildren] = useState<Child[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('my_family')
    if (error) return setError(error.message)
    const list = (data ?? []) as unknown as Child[]
    setChildren(list)
  }, [])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  if (error) return <p className="p-6 text-center text-sm" style={{ color: 'var(--no)' }}>{error}</p>
  if (children === null) return <ScreenSkeleton />

  if (children.length === 0) {
    return (
      <p className="card m-4 p-6 text-center text-sm text-ink-2">
        No children are linked to you yet. When a club approves a registration, or a coach
        adds you as a parent, they appear here.
      </p>
    )
  }

  return (
    <div className="p-3.5">
      {children.map((c) => (
        <ChildCard
          key={c.id}
          child={c}
          open={open === c.id || children.length === 1}
          onToggle={() => setOpen(open === c.id ? null : c.id)}
          onChanged={load}
        />
      ))}
    </div>
  )
}

function ChildCard({
  child: c,
  open,
  onToggle,
  onChanged,
}: {
  child: Child
  open: boolean
  onToggle: () => void
  onChanged: () => Promise<void>
}) {
  const born = c.dob ? new Date(c.dob + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  return (
    <article className="card mb-3 overflow-hidden">
      <button onClick={onToggle} className="w-full px-3.5 py-3 text-left">
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">
            {c.full_name}
            {c.preferred_name && c.preferred_name !== c.full_name ? ` “${c.preferred_name}”` : ''}
          </span>
          {c.number != null && <span className="pill">#{c.number}</span>}
        </span>
        <span className="block truncate text-sm text-ink-3">
          {/* Squad, then birthday, then the club — the club last because a
              parent knows which club they are at, and it is the longest. */}
          {[c.squad?.name ?? 'No squad yet', born ? `born ${born}` : null, c.club].filter(Boolean).join(' · ')}
        </span>
      </button>

      {open && (
        <div className="border-t px-3.5 pb-4" style={{ borderColor: 'var(--line-2)' }}>
          <Section title="About">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {born && (<><dt className="text-ink-3">Born</dt><dd>{born}</dd></>)}
              {c.school && (<><dt className="text-ink-3">School</dt><dd>{c.school}</dd></>)}
              {c.ff_number && (<><dt className="text-ink-3">FFA number</dt><dd className="tabular-nums">{c.ff_number}</dd></>)}
              {c.relationship && (<><dt className="text-ink-3">You are their</dt><dd>{c.relationship}</dd></>)}
              <dt className="text-ink-3">Squad</dt>
              <dd>{c.squad ? `${c.squad.name}${c.squad.season ? ` · ${c.squad.season}` : ''}` : 'Not in a squad yet'}</dd>
              <dt className="text-ink-3">Number</dt>
              <dd>{c.number != null ? `#${c.number}` : 'Not given yet'}</dd>
              {/* Official registration is PlayFootball's, never ours; this is
                  what the club has recorded, and the reminder lands here. */}
              <dt className="text-ink-3">PlayFootball</dt>
              <dd style={{ color: c.official_status === 'registered' || c.official_status === 'not_required' ? 'var(--yes)' : c.official_status === 'pending' ? 'var(--maybe)' : undefined }}>
                {c.official_status === 'registered'
                  ? 'Registered'
                  : c.official_status === 'not_required'
                    ? 'Not needed for this squad'
                    : c.official_status === 'pending'
                      ? 'Pending — finish it before round one'
                      : 'Not yet registered — do it at playfootball.com.au, then tell the club'}
              </dd>
            </dl>
            <p className="mt-2 text-xs text-ink-3">
              Name, date of birth and squad are set by {c.club}. If something is wrong, tell the coach.
            </p>
            <a href={`/card/${c.id}`} className="mt-2 inline-block text-sm underline underline-offset-4" style={{ color: 'var(--brand-text)' }}>
              Player card — photo, number, match-day ID ›
            </a>
          </Section>

          <KitSection child={c} onChanged={onChanged} />
          <MedicalSection child={c} onChanged={onChanged} />
          <ConsentsSection child={c} onChanged={onChanged} />
        </div>
      )}
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="eyebrow pb-1.5">{title}</h3>
      {children}
    </section>
  )
}

function KitSection({ child: c, onChanged }: { child: Child; onChanged: () => Promise<void> }) {
  const [shirt, setShirt] = useState(c.kit.shirt ?? '')
  const [shorts, setShorts] = useState(c.kit.shorts ?? '')
  const [socks, setSocks] = useState(c.kit.socks ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = shirt !== (c.kit.shirt ?? '') || shorts !== (c.kit.shorts ?? '') || socks !== (c.kit.socks ?? '')

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_kit_sizes', {
      p_player: c.id,
      p_shirt: (shirt || undefined) as never,
      p_shorts: (shorts || undefined) as never,
      p_socks: (socks || undefined) as never,
    })
    setBusy(false)
    if (error) return setError(error.message)
    await onChanged()
  }

  return (
    <Section title="Kit sizes">
      <div className="flex flex-col gap-1.5">
        <SizePick label="Shirt" value={shirt} onChange={setShirt} options={SHIRT_SIZES} />
        <SizePick label="Shorts" value={shorts} onChange={setShorts} options={SHIRT_SIZES} />
        <SizePick label="Socks" value={socks} onChange={setSocks} options={SOCK_SIZES} />
      </div>
      {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      {dirty && (
        <button onClick={save} disabled={busy} className="mt-2 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
          {busy ? 'Saving…' : 'Save sizes'}
        </button>
      )}
    </Section>
  )
}

/** One size, from the database's own list — never typed. */
function SizePick({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-14 flex-none text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-lg border px-2 py-1.5 text-sm"
        style={{ borderColor: 'var(--line)' }}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

function MedicalSection({ child: c, onChanged }: { child: Child; onChanged: () => Promise<void> }) {
  const [m, setM] = useState<Medical>(c.medical ?? EMPTY_MEDICAL)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const field = (k: keyof Medical, label: string, type = 'text') => (
    <label className="block text-sm">
      <span className="text-ink-2">{label}</span>
      <input
        type={type}
        value={(m[k] as string | null) ?? ''}
        onChange={(e) => setM({ ...m, [k]: e.target.value || null })}
        className="mt-0.5 w-full rounded-lg border px-3 py-2 text-base"
        style={{ borderColor: 'var(--line)' }}
      />
    </label>
  )

  async function save() {
    setBusy(true)
    setError(null)
    // Straight to the table: RLS lets a guardian write their own child's
    // medical row (0082), and a function here would only restate that.
    const { error } = await createClient()
      .from('player_medical')
      .upsert(
        {
          player_id: c.id,
          academy_id: c.academy_id,
          ...m,
          // The column is not null: unanswered is "no" until the family
          // ticks it, which is the safe reading of a blank.
          first_aid_consent: Boolean(m.first_aid_consent),
        },
        { onConflict: 'player_id' }
      )
    setBusy(false)
    if (error) return setError(error.message)
    setEditing(false)
    await onChanged()
  }

  const has = c.medical && Object.entries(c.medical).some(([k, v]) => k !== 'first_aid_consent' && v)

  if (!editing) {
    return (
      <Section title="Medical and emergency">
        {has ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {c.medical?.emergency_name && (<><dt className="text-ink-3">Emergency</dt><dd>{c.medical.emergency_name}{c.medical.emergency_relation ? ` (${c.medical.emergency_relation})` : ''}{c.medical.emergency_phone ? ` · ${c.medical.emergency_phone}` : ''}</dd></>)}
            {c.medical?.conditions && (<><dt className="text-ink-3">Conditions</dt><dd>{c.medical.conditions}</dd></>)}
            {c.medical?.allergies && (<><dt className="text-ink-3">Allergies</dt><dd>{c.medical.allergies}</dd></>)}
            {c.medical?.medications && (<><dt className="text-ink-3">Medications</dt><dd>{c.medical.medications}</dd></>)}
            {c.medical?.dietary && (<><dt className="text-ink-3">Dietary</dt><dd>{c.medical.dietary}</dd></>)}
            {c.medical?.doctor_name && (<><dt className="text-ink-3">Doctor</dt><dd>{c.medical.doctor_name}{c.medical.doctor_phone ? ` · ${c.medical.doctor_phone}` : ''}</dd></>)}
          </dl>
        ) : (
          <p className="text-sm text-ink-3">Nothing recorded. The coach at the ground only knows what is written here.</p>
        )}
        <p className="mt-1.5 text-xs text-ink-3">Seen by you and the club&apos;s admins. Coaches see only a short note the club writes for the ground.</p>
        <button onClick={() => setEditing(true)} className="mt-2 text-xs underline underline-offset-4" style={{ color: 'var(--brand-text)' }}>
          {has ? 'Update' : 'Add medical and emergency details'}
        </button>
      </Section>
    )
  }

  return (
    <Section title="Medical and emergency">
      <div className="flex flex-col gap-2">
        {field('emergency_name', 'Emergency contact')}
        {field('emergency_phone', 'Their phone', 'tel')}
        {field('emergency_relation', 'Their relationship to the child')}
        {field('conditions', 'Medical conditions')}
        {field('allergies', 'Allergies')}
        {field('medications', 'Medications')}
        {field('dietary', 'Dietary')}
        {field('doctor_name', 'Doctor')}
        {field('doctor_phone', "Doctor's phone", 'tel')}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(m.first_aid_consent)} onChange={(e) => setM({ ...m, first_aid_consent: e.target.checked })} />
          The club may give first aid and call an ambulance if needed
        </label>
      </div>
      {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={save} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setM(c.medical ?? EMPTY_MEDICAL); setEditing(false) }} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>
          Cancel
        </button>
      </div>
    </Section>
  )
}

function ConsentsSection({ child: c, onChanged }: { child: Child; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function set(documentId: string, accepted: boolean) {
    setBusy(documentId)
    setError(null)
    const { error } = await createClient().rpc('set_consent', {
      p_player: c.id,
      p_document: documentId,
      p_accepted: accepted,
    })
    setBusy(null)
    if (error) return setError(error.message)
    await onChanged()
  }

  if (c.consents.length === 0) return null

  return (
    <Section title="Agreements">
      <ul className="flex flex-col gap-2">
        {c.consents.map((k) => (
          <li key={k.document_id} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {k.title}
                {k.required && <span className="text-ink-3"> · required by {c.club}</span>}
              </span>
              <span className="block text-xs" style={{ color: k.accepted === true ? 'var(--yes)' : k.accepted === false ? 'var(--no)' : 'var(--ink-3)' }}>
                {k.accepted === true
                  ? `Agreed${k.accepted_at ? ` ${new Date(k.accepted_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''} · v${k.version}`
                  : k.accepted === false
                    ? `Withdrawn${k.accepted_at ? ` ${new Date(k.accepted_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`
                    : 'Not answered'}
              </span>
            </span>
            <button
              onClick={() => set(k.document_id, k.accepted !== true)}
              disabled={busy === k.document_id}
              className="flex-none rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={k.accepted === true ? { borderColor: 'var(--line)', color: 'var(--ink-2)' } : { borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
            >
              {busy === k.document_id ? '…' : k.accepted === true ? 'Withdraw' : 'Agree'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      <p className="mt-2 text-xs text-ink-3">
        Withdrawing is recorded straight away and the club is told. Withdrawing one the club requires may mean they ring you.
      </p>
    </Section>
  )
}

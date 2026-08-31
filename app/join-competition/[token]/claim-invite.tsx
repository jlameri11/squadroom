'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function ClaimInvite({
  token, signedIn, organisations, competitionName, organiserName, clubName, division, startsOn,
}: {
  token: string
  signedIn: boolean
  organisations: { id: string; name: string }[]
  competitionName: string
  organiserName: string
  clubName: string
  division: string | null
  startsOn: string | null
}) {
  const router = useRouter()
  const [orgId, setOrgId] = useState(organisations[0]?.id ?? 'new')
  const [teamName, setTeamName] = useState(clubName)
  const [ageGroup, setAgeGroup] = useState(division?.match(/U\d+/)?.[0] ?? 'U8')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const heading = (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {organiserName} invites
      </p>
      <h1 className="mt-1 text-2xl font-semibold" style={{ color: '#202842' }}>{clubName}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        to {competitionName}
        {division && ` · ${division}`}
        {startsOn && ` · from ${new Date(startsOn).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`}
      </p>
    </div>
  )

  if (!signedIn) {
    const next = encodeURIComponent(`/join-competition/${token}`)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
        {heading}
        <p className="text-sm text-neutral-500">
          You&apos;ll need an account to accept — it takes one email, no password. Your fixtures
          and squad stay yours; the organiser never sees your members or your chat.
        </p>
        <div className="flex flex-col gap-2">
          <a href={`/signup?next=${next}`} className="rounded-xl px-4 py-3 text-center font-medium text-white" style={{ background: '#202842' }}>
            Set up {clubName}
          </a>
          <a href={`/signin?next=${next}`} className="rounded-xl border border-neutral-300 px-4 py-3 text-center font-medium">
            We already use Squadroom
          </a>
        </div>
      </main>
    )
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()

    let academyId = orgId
    if (orgId === 'new') {
      const { data, error } = await supabase.rpc('create_academy', { p_name: clubName, p_type: 'club' })
      if (error || !data) { setBusy(false); return setError(error?.message ?? 'Could not create your club.') }
      academyId = data
    }

    // The entry becomes this team, so every fixture already scheduled against
    // the club's name lands in this team's calendar.
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .insert({ academy_id: academyId, name: teamName.trim(), age_group: ageGroup, season: String(new Date().getFullYear()) })
      .select('id')
      .single()
    if (teamErr) { setBusy(false); return setError(teamErr.message) }

    const { error: claimErr } = await supabase.rpc('claim_competition_invite', {
      p_token: token, p_academy: academyId, p_team: team.id,
    })
    setBusy(false)
    if (claimErr) return setError(claimErr.message)

    router.replace('/')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      {heading}

      <form onSubmit={claim} className="flex flex-col gap-4">
        {organisations.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Accept as</span>
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="rounded-xl border border-neutral-300 px-3 py-3">
              {organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value="new">Set up {clubName} as a new club</option>
            </select>
          </label>
        )}

        <div className="flex gap-3">
          <label className="flex flex-[2] flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Team entering</span>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required className="rounded-xl border border-neutral-300 px-3 py-3" />
          </label>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Age</span>
            <input value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} required className="rounded-xl border border-neutral-300 px-3 py-3" />
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy} className="rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50" style={{ background: '#202842' }}>
          {busy ? 'Accepting…' : 'Accept and see our fixtures'}
        </button>
        <p className="text-center text-xs text-neutral-500">
          You&apos;ll see the draw and the ladder. {organiserName} will not see your members,
          your children or your chat.
        </p>
      </form>
    </main>
  )
}

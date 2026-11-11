'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * The two safeguarding switches, with their consequences written out.
 *
 * Both default to the restrictive option. An academy can open them, but it
 * should be a decision someone made on purpose, having read what it does -
 * not something that drifted open because the wording was vague.
 */

export function AcademySettings({
  academyId, dmPolicy, directoryVisibility,
  publicPlayerNames = 'off',
  siblingDiscountBps = [],
  feesDisclosedSeason = null,
  blockRsvpWhenOverdue = false,
  overdueGraceDays = 14,
  contactEmail,
  twoStepRequired,
  clubMode,
  miniroosScores = false,
  photoRequired = false,
}: {
  academyId: string
  dmPolicy: string
  directoryVisibility: string
  publicPlayerNames?: 'off' | 'initials' | 'full'
  /** 0102's ladder: index 0 is the second child, the last entry every child beyond it. */
  siblingDiscountBps?: number[]
  /** R-18: the season the club last ticked "fees disclosed in PlayFootball". */
  feesDisclosedSeason?: string | null
  /** W-07: a family with a fee past due cannot say yes to a game until it is paid. */
  blockRsvpWhenOverdue?: boolean
  overdueGraceDays?: number
  /**
   * 0213: the address replies to the organisation's emailed notices go to.
   * Undefined until the column exists, and then the section is not shown.
   */
  contactEmail?: string | null
  /** 0231: whether the club requires two-step sign-in of its owners and admins; undefined until the column exists. */
  twoStepRequired?: boolean
  /** 0236: Big Club Mode — streams, committee roles and rosters; undefined until the column exists. */
  clubMode?: boolean
  /** 0251: MiniRoos (U5–U11) keep no score and no ladder unless the club turns this on. */
  miniroosScores?: boolean
  /** 0263: a passport-style photo with every registration. */
  photoRequired?: boolean
}) {
  const router = useRouter()
  const [dm, setDm] = useState(dmPolicy)
  const [dir, setDir] = useState(directoryVisibility)
  const [names, setNames] = useState(publicPlayerNames)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Shown as whole percent, stored as basis points. Two rungs is what every
  // club actually writes — "2nd child 10% off, 3rd and beyond 20%" — and the
  // database holds a longer ladder for anyone who needs one.
  const thisSeason = String(new Date().getFullYear())
  const [feesSeason, setFeesSeason] = useState(feesDisclosedSeason)
  const [blockOverdue, setBlockOverdue] = useState(blockRsvpWhenOverdue)
  const [miniroos, setMiniroos] = useState(miniroosScores)
  const [photoReq, setPhotoReq] = useState(photoRequired)
  const [grace, setGrace] = useState(String(overdueGraceDays))
  const [second, setSecond] = useState(String((siblingDiscountBps[0] ?? 0) / 100))
  const [third, setThird] = useState(String((siblingDiscountBps[1] ?? siblingDiscountBps[0] ?? 0) / 100))
  const [contact, setContact] = useState(contactEmail ?? '')

  // Typed to the columns this screen may touch, rather than a loose
  // record. The generated types then check the values as well as the keys.
  type Patch =
    | { directory_visibility: 'staff_only' | 'all' }
    | { dm_policy: 'staff_only' | 'open' }
    | { public_player_names: 'off' | 'initials' | 'full' }
    | { sibling_discount_bps: number[] }
    | { playfootball_fees_disclosed_season: string | null; playfootball_fees_disclosed_at: string | null }
    | { block_rsvp_when_overdue: boolean }
    | { overdue_grace_days: number }
    | { contact_email: string | null }

  const ladder = (() => {
    const a = Math.round(Number(second) * 100)
    const b = Math.round(Number(third) * 100)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    if (a === 0 && b === 0) return []
    // The last rung applies to every child beyond it, so a single rung is
    // "every sibling", and two rungs where the second equals the first are
    // one rung.
    return b === a ? [a] : [a, b]
  })()
  const ladderDirty = JSON.stringify(ladder) !== JSON.stringify(siblingDiscountBps)

  // S-07 (0231): two-step sign-in for the people who run the club — one way.
  const [requiring, setRequiring] = useState(false)
  async function requireTwoStep() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('require_two_step', { p_academy: academyId })
    setBusy(false)
    setRequiring(false)
    if (error) return setError(error.message)
    router.refresh()
  }
  async function update(patch: Patch) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('academies').update(patch).eq('id', academyId)
    setBusy(false)
    if (error) return setError(error.message)
    router.refresh()
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {error && <p className="text-sm ">{error}</p>}
      <section data-features-link>
        <h2 className="font-semibold">Features</h2>
        <p className="mt-1 text-sm text-ink-2">Every feature that is not core, with a switch. Off means it appears nowhere.</p>
        <a href="/settings/features" className="mt-2 inline-block rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-features-open>
          Features
        </a>
      </section>

      {clubMode !== undefined && (
        <section data-club-mode={clubMode ? 'on' : 'off'}>
          <h2 className="font-semibold">Club mode</h2>
          {clubMode ? (
            <p className="mt-1 text-sm text-ink-2">
              On. Streams on teams, several roles per person (President, Registrar, Treasurer, coordinators, team managers, Welfare officer), the activity log. Roles are handed out under Admin → Roles.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-2">
                For a club with streams, a committee and many teams: club-defined streams (MiniRoos, Juniors, Girls, Women, NPL, Seniors…) on teams, several roles per person with their own scope, and a log of who changed what. An academy loses nothing by leaving it off.
              </p>
              <button
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  const { error } = await createClient().rpc('enable_club_mode', { p_academy: academyId })
                  setBusy(false)
                  if (error) return setError(error.message)
                  router.refresh()
                }}
                disabled={busy}
                className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
                data-club-mode-enable
              >
                Turn on club mode
              </button>
            </>
          )}
        </section>
      )}

      {twoStepRequired !== undefined && (
        <section data-two-step-required={twoStepRequired ? 'on' : 'off'}>
          <h2 className="font-semibold">Two-step sign-in for owners and admins</h2>
          {twoStepRequired ? (
            <p className="mt-1 text-sm text-ink-2">
              Required. Everyone who runs this club signs in with their password and a six-digit code from an authenticator app;
              an owner or admin without one is asked to set it up before anything else. Coaches and families may choose.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-2">
                Not yet. New clubs on Squadroom require it from day one; this club was here before that. When you turn it on,
                every owner and admin without an authenticator app meets a set-up screen on their next open, and has no admin
                powers until they finish it — so tell them first. It cannot be turned off again.
              </p>
              {requiring ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={requireTwoStep} disabled={busy} className="min-w-fit rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-two-step-require-confirm>
                    {busy ? 'Turning it on…' : 'Yes, require it from now'}
                  </button>
                  <button onClick={() => setRequiring(false)} className="min-w-fit rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Not yet</button>
                </div>
              ) : (
                <button onClick={() => setRequiring(true)} disabled={busy} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-two-step-require>
                  Require two-step sign-in
                </button>
              )}
            </>
          )}
        </section>
      )}

      {contactEmail !== undefined && (
        <section data-contact-email>
          <h2 className="font-semibold">Contact email</h2>
          <p className="mt-1 text-sm text-ink-2">
            Where replies go. A competition&apos;s notices are also emailed, and a family or a club that
            replies reaches this address. Use one somebody reads.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="email"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="secretary@yourclub.org.au"
              aria-label="Contact email"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--line)' }}
            />
            <button
              onClick={() => update({ contact_email: contact.trim() || null })}
              disabled={busy || contact.trim() === (contactEmail ?? '')}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
            >
              Save
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="font-semibold">Player names on public pages</h2>
        <p className="mt-1 text-sm text-ink-2">
          A published competition page can be opened by anyone with the link — that is what makes
          it useful to players, grandparents and visiting clubs. This decides whether your players
          are named on it.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {([
            {
              value: 'off' as const,
              label: 'Not at all',
              hint: 'Clubs and scores only. Nobody is named.',
            },
            {
              value: 'initials' as const,
              label: 'First name and initial',
              hint: '“Leo W.” — enough to read a team sheet, not a child’s full name on an indexable page.',
            },
            {
              value: 'full' as const,
              label: 'Full names',
              hint: 'What Dribl publishes. Choose this if your competition expects team sheets.',
            },
          ]).map((o) => (
            <button
              key={o.value}
              onClick={() => { setNames(o.value); void update({ public_player_names: o.value }) }}
              aria-pressed={names === o.value}
              disabled={busy}
              className="flex items-start gap-3 rounded-xl border p-3 text-left"
              style={{
                borderColor: names === o.value ? 'var(--brand)' : 'var(--line)',
                background: names === o.value ? 'var(--surface-2)' : 'var(--surface)',
              }}
            >
              <span
                className="mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full border"
                style={{
                  borderColor: names === o.value ? 'var(--brand)' : 'var(--line)',
                  background: names === o.value ? 'var(--brand)' : 'transparent',
                }}
              />
              <span className="min-w-0">
                <span className="block font-medium">{o.label}</span>
                <span className="block text-sm text-ink-3">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Said here rather than buried, because it is the sentence that makes
            the whole setting defensible to a family who asks. */}
        <p className="mt-2 text-xs text-ink-3">
          Any family can ask to be left off, whatever is set here, and that always wins. Only your
          own academy&apos;s players are affected — a competition you run never publishes another
          club&apos;s children.
        </p>
      </section>


      <section>
        <h2 className="font-semibold">Family phone numbers</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Coaches and admins are always contactable. This is about whether families can
          see each other.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <Option
            on={dir === 'staff_only'}
            disabled={busy}
            title="Staff only"
            detail="Parents can call coaches, not each other. The safer default."
            onClick={() => { setDir('staff_only'); update({ directory_visibility: 'staff_only' }) }}
          />
          <Option
            on={dir === 'all'}
            disabled={busy}
            title="Everyone in the academy"
            detail="Any member can call or WhatsApp any other. Convenient for lift-sharing; it also means every parent has every other parent's number."
            onClick={() => { setDir('all'); update({ directory_visibility: 'all' }) }}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Family discounts</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Taken off every fee, automatically, for the second child and beyond. Children are
          ranked by age; twins count as siblings. Worked out at checkout from the price the
          club set, so the discount a family sees is the one they are charged.
        </p>
        <div className="mt-3 flex gap-2">
          <label className="flex-1 text-sm">
            <span className="text-ink-2">2nd child</span>
            <span className="mt-0.5 flex items-center gap-1 rounded-lg border px-2" style={{ borderColor: 'var(--line)' }}>
              <input
                value={second}
                onChange={(e) => setSecond(e.target.value)}
                inputMode="decimal"
                className="w-full min-w-0 py-2 tabular-nums"
                aria-label="Second child discount, percent"
              />
              <span className="flex-none whitespace-nowrap text-ink-3">% off</span>
            </span>
          </label>
          <label className="flex-1 text-sm">
            <span className="text-ink-2">3rd and beyond</span>
            <span className="mt-0.5 flex items-center gap-1 rounded-lg border px-2" style={{ borderColor: 'var(--line)' }}>
              <input
                value={third}
                onChange={(e) => setThird(e.target.value)}
                inputMode="decimal"
                className="w-full min-w-0 py-2 tabular-nums"
                aria-label="Third child and beyond discount, percent"
              />
              <span className="flex-none whitespace-nowrap text-ink-3">% off</span>
            </span>
          </label>
        </div>
        {ladderDirty && ladder && (
          <button
            onClick={() => update({ sibling_discount_bps: ladder })}
            disabled={busy}
            className="mt-2 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
          >
            {ladder.length === 0 ? 'Turn discounts off' : 'Save discounts'}
          </button>
        )}
      </section>

      <section data-miniroos-section>
        <h2 className="font-semibold">MiniRoos scores</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Off by default: a club game in U5–U11 keeps no score and no ladder — the goals are cheered in the chat,
          the tally is not kept on screen. Competition games keep their own rule. Turn it on if your club keeps
          MiniRoos scores.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={miniroos}
            disabled={busy}
            onChange={async (e) => {
              setMiniroos(e.target.checked)
              await update({ miniroos_scores: e.target.checked } as unknown as Patch)
            }}
            data-miniroos-scores
          />
          Show scores for MiniRoos (U5–U11) club games
        </label>
      </section>

      {/* 0263: the registration photo. */}
      <section data-photo-required-section>
        <h2 className="font-semibold">Registration photo</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          The form asks for a passport-style photo (face in view, no hat or sunglasses, recent). It stays private to the
          club until you accept the registration; then it is on the player card and the referee&apos;s team sheet. Off,
          the photo is optional.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={photoReq}
            disabled={busy}
            onChange={async (e) => {
              setPhotoReq(e.target.checked)
              await update({ photo_required: e.target.checked } as unknown as Patch)
            }}
            data-photo-required
          />
          A photo is required to register
        </label>
      </section>

      <section>
        <h2 className="font-semibold">Overdue fees and attendance</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Off by default. On, a family with a fee more than the grace period past due cannot say
          <b> yes</b> to a game or training until it is paid; they can still say no or maybe, and a
          coach marking attendance is never blocked. Squadroom never charges the family anything itself.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={blockOverdue}
            disabled={busy}
            onChange={async (e) => {
              setBlockOverdue(e.target.checked)
              await update({ block_rsvp_when_overdue: e.target.checked })
            }}
          />
          Block &ldquo;yes&rdquo; while a fee is overdue
        </label>
        {blockOverdue && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-ink-2">Grace period</span>
            <input value={grace} onChange={(e) => setGrace(e.target.value)} inputMode="numeric" className="w-16 rounded-lg border px-2 py-1.5 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} />
            <span className="text-ink-3">days after the due date</span>
            {Number(grace) !== overdueGraceDays && Number.isFinite(Number(grace)) && (
              <button onClick={() => update({ overdue_grace_days: Math.max(0, Math.min(365, Math.round(Number(grace)))) })} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>Save</button>
            )}
          </label>
        )}
      </section>

      <section>
        <h2 className="font-semibold">Fees in PlayFootball</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Football Australia&apos;s Circular 26-02 (1 Oct 2026) says an affiliated club must list every
          fee, levy and charge in PlayFootball, and justify it if asked. Squadroom can&apos;t check that
          for you; it can make sure nobody forgot. Tick it once a season.
        </p>
        {feesSeason === thisSeason ? (
          <p className="mt-2 flex items-center gap-2 text-sm">
            <span className="pill" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>Done for {thisSeason}</span>
            <button
              onClick={async () => {
                await update({ playfootball_fees_disclosed_season: null, playfootball_fees_disclosed_at: null })
                setFeesSeason(null)
              }}
              disabled={busy}
              className="text-xs underline underline-offset-2 text-ink-3"
            >
              undo
            </button>
          </p>
        ) : (
          <div className="mt-2">
            <p className="mb-2 text-sm" style={{ color: 'var(--maybe)' }}>
              Not yet ticked for {thisSeason}{feesSeason ? ` (last done ${feesSeason})` : ''}.
            </p>
            <button
              onClick={async () => {
                await update({ playfootball_fees_disclosed_season: thisSeason, playfootball_fees_disclosed_at: new Date().toISOString() })
                setFeesSeason(thisSeason)
              }}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
            >
              Our {thisSeason} fees are in PlayFootball
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold">Private messages</h2>
        <p className="mt-0.5 text-sm text-ink-2">Inside Squadroom, where messages are kept.</p>
        <div className="mt-3 flex flex-col gap-2">
          <Option
            on={dm === 'staff_only'}
            disabled={busy}
            title="With coaches and admins only"
            detail="A parent can message their coach. Two parents cannot open a private thread."
            onClick={() => { setDm('staff_only'); update({ dm_policy: 'staff_only' }) }}
          />
          <Option
            on={dm === 'open'}
            disabled={busy}
            title="Anyone in the academy"
            detail="Any two members can message privately."
            onClick={() => { setDm('open'); update({ dm_policy: 'open' }) }}
          />
        </div>
      </section>
    </div>
  )
}

function Option({
  on, title, detail, onClick, disabled,
}: {
  on: boolean; title: string; detail: string; onClick: () => void; disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border p-3 text-left disabled:opacity-60"
      style={{ borderColor: on ? 'var(--brand)' : 'var(--line)', background: on ? 'var(--brand-faint)' : undefined }}
    >
      <span className="flex items-center gap-2">
        <span
          className="grid h-4 w-4 flex-none place-items-center rounded-full border"
          style={{ borderColor: on ? 'var(--brand)' : 'var(--ink-3)' }}
        >
          {on && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--brand)' }} />}
        </span>
        <span className="font-medium">{title}</span>
      </span>
      <span className="mt-1 block pl-6 text-sm text-ink-2">{detail}</span>
    </button>
  )
}

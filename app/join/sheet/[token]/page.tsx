import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/admin'
import { joinLinkFilter } from '@/lib/join'
import { siteUrl } from '@/lib/site'
import { PrintButton } from './print-button'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * /join/sheet/<code> — the squad's join code and QR as a sheet for the
 * noticeboard, the canteen window or a stack on registration day (Big Club
 * Mode item 5; 0248). The same link as the panel on the team page, with the
 * three steps a family follows — including "your children's names and
 * birthdays as the club has them", which is what matches a family to a
 * roster the club has already imported instead of adding every child twice.
 *
 * Public, like /join/<token>: anyone holding the code can already join, so
 * the sheet gives nothing away that the code did not. Black on white on
 * purpose — it is paper — and nothing about any family is on it.
 */
export default async function JoinSheetPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const admin = createAdminClient()
  const { column, value } = joinLinkFilter(token)

  const { data: link } = await admin
    .from('join_links')
    .select('id, token, code, role, max_uses, use_count, expires_at, revoked_at, academies(name), teams(name, age_group)')
    .eq(column, value)
    .maybeSingle()

  const dead =
    !link ||
    link.revoked_at !== null ||
    new Date(link.expires_at) < new Date() ||
    (link.max_uses !== null && link.use_count >= link.max_uses)

  if (dead) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-2xl font-semibold">This link has expired</h1>
        <p className="text-sm text-ink-2">Ask your coach for a new one — they can create it in a couple of taps.</p>
      </main>
    )
  }

  const academy = firstOf(link.academies)?.name ?? 'the club'
  const team = firstOf(link.teams)
  const adult = link.role === 'player'
  const origin = siteUrl()
  const host = origin.replace(/^https?:\/\//, '')
  const qr = await QRCode.toString(`${origin}/join/${link.token}`, {
    type: 'svg',
    margin: 1,
    width: 220,
    color: { dark: '#101012', light: '#ffffff' },
  })
  const expires = new Date(link.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <main
      className="mx-auto min-h-dvh w-full max-w-[42rem] px-6 py-8"
      style={{ background: '#ffffff', color: '#101012' }}
      data-join-sheet
    >
      <style>{`@media print { .no-print { display: none !important } @page { margin: 16mm } body { background: #fff } }`}</style>
      <p className="eyebrow" style={{ color: '#555' }}>{academy}</p>
      <h1 className="display mt-1 text-[2.25rem] leading-none" style={{ textWrap: 'balance' }}>
        Join {team?.name ?? academy}
      </h1>
      <p className="mt-2 text-base" style={{ color: '#333' }}>
        {adult ? 'Players join as themselves.' : `For the families of ${team ? 'this squad' : academy}.`}
        {team?.age_group ? ` ${team.age_group}.` : ''}
      </p>

      <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow" style={{ color: '#555' }}>Join code</p>
          <p className="display mt-1 text-[3.25rem] leading-none tabular-nums" style={{ letterSpacing: '0.14em' }} data-sheet-code>
            {link.code}
          </p>
          <p className="mt-3 text-base">
            Enter it at <b>{host}/join</b>
          </p>
        </div>
        <div
          className="w-[14.5rem] flex-none self-center rounded-xl p-2"
          style={{ background: '#ffffff', border: '1px solid #e2e2e2' }}
          dangerouslySetInnerHTML={{ __html: qr }}
        />
      </div>

      <ol className="mt-10 flex flex-col gap-4 text-base">
        <Step n={1}>Scan the code with your phone&apos;s camera, or go to <b>{host}/join</b> and type it.</Step>
        <Step n={2}>
          Your name, mobile and email
          {adult ? ', and your date of birth.' : ', and your children’s names and birthdays as the club has them.'}
        </Step>
        <Step n={3}>
          The coach approves you, and you&apos;re in: the squad&apos;s chat, games and training
          {adult ? '.' : ', for your children.'}
        </Step>
      </ol>

      <p className="mt-8 text-sm" style={{ color: '#555' }}>
        Nothing is sent by text, and there is nothing to download — it works in the browser. The code works until {expires}.
      </p>

      <PrintButton />
    </main>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="grid h-7 w-7 flex-none place-items-center rounded-full text-sm font-bold"
        style={{ background: '#101012', color: '#ffffff' }}
      >
        {n}
      </span>
      <span className="min-w-0 pt-0.5">{children}</span>
    </li>
  )
}

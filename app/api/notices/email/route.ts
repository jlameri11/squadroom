import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeHtml, fromAs, mailConfigured, sendEach, type Mail } from '@/lib/mail/resend'
import { siteUrl } from '@/lib/site'

/**
 * A competition's notice, also by email (Joey, 5 Nov 2026).
 *
 * Called by the notice composer after a notice is posted. One email per
 * person — from "<League> via Squadroom", reply-to the league's contact
 * address, with a footer saying why they got it — to everyone the notice
 * was for who has a confirmed address. Club and league notices need no
 * news-and-offers consent; they are the competition talking to its people.
 *
 * WITHOUT RESEND_API_KEY IT DOES NOTHING, QUIETLY: the notice has already
 * arrived in the app and by push.
 *
 * Who may ask: the notice's own sender, and only while they may post in its
 * channel — checked with THEIR session. Only then are the addresses read,
 * with the service role, here on the server; they are never sent back. A
 * league never sees another club's families' addresses (0214).
 *
 * Each address is claimed in notice_emails before it is sent, so a second
 * call — a double tap, a retry — emails nobody twice.
 */
export async function POST(req: Request) {
  const { messageId } = ((await req.json().catch(() => ({}))) ?? {}) as { messageId?: string }
  if (!messageId || !/^[0-9a-f-]{36}$/i.test(messageId)) {
    return NextResponse.json({ error: 'which notice?' }, { status: 400 })
  }
  if (!mailConfigured()) return NextResponse.json({ ok: true, emailed: 0, email: 'off' })

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

  const { data: msg } = await supabase
    .from('messages')
    .select('id, channel_id, sender_id, body, attachments, audience, deleted_at')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg || msg.deleted_at) return NextResponse.json({ error: 'no such notice' }, { status: 404 })
  if (msg.sender_id !== auth.user.id) return NextResponse.json({ error: 'not your notice' }, { status: 403 })
  const { data: mayPost } = await supabase.rpc('can_post_in_channel', { p_channel: msg.channel_id })
  if (!mayPost) return NextResponse.json({ error: 'only the league sends its notices' }, { status: 403 })

  // The suites' notices ("TEST:: …", the tag every suite writes with) are
  // never emailed: once a key exists they would reach real inboxes — Joey's
  // among them, as the SPL's organiser — on every run.
  if (/^TEST::/.test((msg.body ?? '').trim())) return NextResponse.json({ ok: true, emailed: 0, email: 'test' })

  const admin = createAdminClient()
  const { data: people, error } = await admin.rpc('notice_email_recipients', { p_message: messageId })
  // Before 0214 is applied the function does not exist: nothing to send.
  if (error || !people || people.length === 0) return NextResponse.json({ ok: true, emailed: 0 })

  // Claim first: whoever is already claimed was emailed by an earlier call.
  const { data: claimed } = await admin
    .from('notice_emails')
    .upsert(people.map((p) => ({ message_id: messageId, profile_id: p.profile_id })), {
      onConflict: 'message_id,profile_id',
      ignoreDuplicates: true,
    })
    .select('profile_id')
  const mine = new Set((claimed ?? []).map((c) => c.profile_id))
  const to = people.filter((p) => mine.has(p.profile_id))
  if (to.length === 0) return NextResponse.json({ ok: true, emailed: 0 })

  const link = `${siteUrl()}/chat/${msg.channel_id}`
  const body = (msg.body ?? '').trim()
  const files = Array.isArray(msg.attachments) ? msg.attachments.length : 0
  const mails: Mail[] = to.map((p) => {
    const why =
      p.standing === 'family' ? `your family has a team entered in ${p.competition}`
      : p.standing === 'staff' ? `you are on the staff of a club entered in ${p.competition}, or an officer of ${p.league}`
      : p.standing === 'referee' ? `you referee for ${p.league}`
      : `you help run ${p.competition}`
    const subject = `${p.competition}: ${(body.split('\n')[0] || 'a new notice').slice(0, 70)}`
    const attachLine = files > 0 ? `\n\nThis notice has ${files} ${files === 1 ? 'attachment' : 'attachments'} — open it in Squadroom to see ${files === 1 ? 'it' : 'them'}.` : ''
    const staffLine = msg.audience === 'club_staff' ? 'For club staff only.\n\n' : ''
    const footer = `You are getting this because ${why}. ${p.league} sends notices to everyone in ${p.competition} through Squadroom${p.reply_to ? `; replies go to ${p.reply_to}` : ''}.`
    return {
      from: fromAs(`${p.league} via Squadroom`),
      to: p.email,
      ...(p.reply_to ? { reply_to: p.reply_to } : {}),
      subject,
      text: `${staffLine}${body}${attachLine}\n\nOpen in Squadroom: ${link}\n\n—\n${footer}`,
      html:
        `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#101012">` +
        (msg.audience === 'club_staff' ? `<p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#4d4d55">For club staff only</p>` : '') +
        `<p style="font-size:16px;line-height:1.5;white-space:pre-wrap">${escapeHtml(body)}</p>` +
        (files > 0 ? `<p style="font-size:14px;color:#4d4d55">${files} ${files === 1 ? 'attachment' : 'attachments'} — open the notice in Squadroom to see ${files === 1 ? 'it' : 'them'}.</p>` : '') +
        `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#101012;color:#ffffff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Open in Squadroom</a></p>` +
        `<p style="font-size:12px;line-height:1.5;color:#6b6b73;border-top:1px solid #e4e4e7;padding-top:12px">${escapeHtml(footer)}</p>` +
        `</div>`,
    }
  })

  const ids = await sendEach(mails)
  // A batch that failed is released, so the next call can try those again.
  const failed = to.filter((_, i) => ids[i] === null).map((p) => p.profile_id)
  if (failed.length) {
    await admin.from('notice_emails').delete().eq('message_id', messageId).in('profile_id', failed)
  }
  return NextResponse.json({ ok: true, emailed: to.length - failed.length })
}

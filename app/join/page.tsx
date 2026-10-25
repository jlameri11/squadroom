import { JoinWithCode } from './join-with-code'

/**
 * /join — the door for somebody holding a code and nothing else.
 *
 * Every other way in needs a link: tapped from a WhatsApp group, scanned off
 * a QR at a come-and-try day. That covers the parent who was sent something
 * and leaves out the one who was told something — at the end of training, at
 * the school gate, down the phone from another parent. A code is how a club
 * recruits when it is not holding anybody's phone.
 *
 * This is also the answer to "how does an individual register". An
 * organisation registers at /signup and founds itself at /start. A person
 * does not found anything: they join something that already exists, and a
 * code is what says which. The coach still approves them afterwards, which is
 * the identity gate for this whole product and is not weakened by the code
 * being short.
 */
export const metadata = {
  title: 'Join with a code',
  description: 'Enter the code your coach gave you.',
}

export default function JoinLandingPage() {
  return <JoinWithCode />
}

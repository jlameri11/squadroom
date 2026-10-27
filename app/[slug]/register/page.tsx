import type { Metadata } from 'next'
import { RegisterForm } from './register-form'

/**
 * A club's public registration page.
 *
 * A static shell; the browser fetches through `public_programs`, which is the
 * one anon-callable read in the product and publishes no child, no family and
 * no phone number.
 *
 * A SLUG THAT DOES NOT EXIST ALSO RETURNS 200, with "not found" rendered in
 * the page. That is deliberate and matches the rest of this flow: a 404 here
 * would make the URL an enumeration oracle for which clubs are on Squadroom,
 * which is the same reason a draft program is not listed as closed.
 *
 * NOT indexed. A club's own site should link here, and a search engine should
 * not be the reason somebody lands on a form that collects a child's date of
 * birth. The rest of the app is already noindex (see the root layout); this
 * page says so for itself because it is the one page meant to be shared.
 */
export const metadata: Metadata = {
  title: 'Register',
  robots: { index: false, follow: false },
}

export default async function RegisterPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  return <RegisterForm slug={slug} />
}

import { AppBar, Screen } from './app-shell'

/**
 * A whole screen: navy bar, scrolling content, tab bar.
 *
 * Server-side so a page.tsx stays thin — it passes strings, not layout. The
 * two bars are client components because the tab bar needs to know which
 * route is current; everything else here renders on the server.
 */
export function AppShellPage({
  title,
  meta,
  back,
  action,
  isStaff = true,
  unread = 0,
  brand,
  children,
}: {
  title: string
  meta?: string
  back?: string
  action?: React.ReactNode
  isStaff?: boolean
  unread?: number
  /** The club's colour. Overrides --brand for everything inside. */
  brand?: string | null
  academyId?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-1 flex-col"
      style={brand ? ({ '--brand': brand } as React.CSSProperties) : undefined}
    >
      <AppBar title={title} meta={meta} back={back} action={action} />
      <Screen>{children}</Screen>
    </div>
  )
}

import { AppBar, TabBar, Screen } from './app-shell'

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
  children,
}: {
  title: string
  meta?: string
  back?: string
  action?: React.ReactNode
  isStaff?: boolean
  unread?: number
  academyId?: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <AppBar title={title} meta={meta} back={back} action={action} />
      <Screen>{children}</Screen>
      <TabBar isStaff={isStaff} unread={unread} />
    </div>
  )
}

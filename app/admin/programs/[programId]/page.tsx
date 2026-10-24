import { ProgramScreen } from './program-screen'

/** A static shell; the browser fetches. See lib/hooks/use-screen.ts. */
export default async function ProgramPage(ctx: { params: Promise<{ programId: string }> }) {
  const { programId } = await ctx.params
  return <ProgramScreen programId={programId} />
}

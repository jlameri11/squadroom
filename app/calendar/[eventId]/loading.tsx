import { GameSkeleton } from './game-skeleton'

/** What the route paints before the shell arrives: the game's own shape, not Home's. */
export default function Loading() {
  return <GameSkeleton />
}

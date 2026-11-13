import { ChatSkeleton } from './chat-skeleton'

/** What the route paints before the shell arrives: the chat's own shape, not Home's. */
export default function Loading() {
  return <ChatSkeleton />
}

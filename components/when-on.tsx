'use client'

import type { ReactNode } from 'react'
import { useFeatures, type FeatureKey } from '@/lib/features'

/**
 * Renders its children only while the feature is switched on for the
 * organisation the browser is showing (0242). Off means nothing — not a
 * greyed button, not an empty tab. Until the switches are known the
 * children show, so a page never flashes without its features on a slow
 * connection; a switched-off feature then disappears on the first paint
 * after the answer.
 */
export function WhenOn({ feature, orgId, children }: { feature: FeatureKey; orgId?: string | null; children: ReactNode }) {
  const { on } = useFeatures(orgId)
  return on(feature) ? <>{children}</> : null
}

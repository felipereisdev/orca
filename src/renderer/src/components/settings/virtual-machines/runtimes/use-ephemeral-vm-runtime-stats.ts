import { useEffect, useState } from 'react'
import type { EphemeralVmRecipeStats } from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { installWindowVisibilityTimeoutPoller } from '@/lib/window-activity/window-visibility-timeout-poller'

// Main caches each runtime's stats this long, so asking sooner would only re-read its cache.
const STATS_REFRESH_MS = 15_000

/**
 * Each runtime's stats (null when its recipe has none) while the VM rows are mounted, refreshed at
 * most every 15 s and paused while the window is hidden. Main runs no timer; this asks. Main bounds
 * every answer to 5 s, so a refresh always completes.
 */
export function useEphemeralVmRuntimeStats(
  runtimeIds: readonly string[]
): Record<string, EphemeralVmRecipeStats | null> {
  const [stats, setStats] = useState<Record<string, EphemeralVmRecipeStats | null>>({})
  const idsKey = [...runtimeIds].sort().join('\n')
  useEffect(() => {
    const readStats = window.api?.ephemeralVm?.runtimeStats
    const ids = idsKey ? idsKey.split('\n') : []
    if (!readStats || ids.length === 0) {
      return
    }
    let disposed = false
    const stop = installWindowVisibilityTimeoutPoller({
      // Each row updates as its own answer lands; a slow one never holds back the rest.
      run: async () => {
        await Promise.allSettled(
          ids.map(async (runtimeId) => {
            const value = await readStats({ runtimeId }).catch(() => null)
            if (!disposed) {
              setStats((previous) => ({ ...previous, [runtimeId]: value }))
            }
          })
        )
      },
      getDelayMs: () => STATS_REFRESH_MS,
      cooldownMs: STATS_REFRESH_MS
    })
    return () => {
      disposed = true
      stop()
    }
  }, [idsKey])
  return stats
}

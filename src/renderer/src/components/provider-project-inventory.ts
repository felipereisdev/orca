import { useEffect, useState } from 'react'

export type ProviderProjectInventoryRead<T> = { connected: boolean; projects: T[] }

/** One read of a provider's projects per source; `load` must be stable (module-level). */
export function useProviderProjectInventory<S, T>(
  source: S,
  enabled: boolean,
  load: (source: S) => Promise<ProviderProjectInventoryRead<T>>
) {
  const [inventory, setInventory] = useState<{
    source: S
    projects: T[]
    connected: boolean
    error: string | null
  } | null>(null)
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    void load(source)
      .then((read) => {
        if (!cancelled) {
          setInventory({ source, ...read, error: null })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setInventory({
            source,
            connected: false,
            projects: [],
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [source, enabled, load])
  const current = inventory?.source === source ? inventory : null
  return {
    projects: current?.projects ?? [],
    connected: current?.connected ?? false,
    error: current?.error ?? null,
    loading: enabled && current === null
  }
}

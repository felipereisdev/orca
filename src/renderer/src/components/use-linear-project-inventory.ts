import { useEffect, useState } from 'react'
import type { LinearProjectSummary } from '../../../shared/linear/project-types'
import type { RuntimeClientTarget } from '../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { getLinearProjectSearchRequestQuery } from './linear-project-search-query'
import { linearStatusForTarget } from '@/runtime/linear/runtime-linear-client'
import { linearListProjectsForTarget } from '@/runtime/linear/runtime-linear-project-client'
import {
  useProviderProjectInventory,
  type ProviderProjectInventoryRead
} from './provider-project-inventory'

// The provider's page cap: per workspace, the most recently updated or best-matching projects.
const PROJECT_LIMIT = 50
const SEARCH_DEBOUNCE_MS = 250

async function readLinearProjects(
  target: RuntimeClientTarget
): Promise<ProviderProjectInventoryRead<LinearProjectSummary>> {
  const status = await linearStatusForTarget(target)
  return {
    connected: status.connected,
    projects: status.connected
      ? (await linearListProjectsForTarget(target, undefined, PROJECT_LIMIT, 'all')).items
      : []
  }
}

export function useLinearProjectInventory(source: RuntimeClientTarget, enabled: boolean) {
  return useProviderProjectInventory(source, enabled, readLinearProjects)
}

/** Server search for `query`; null while the query is empty (callers show the recent list). */
export function useLinearProjectSearch(target: RuntimeClientTarget, query: string) {
  const trimmed = query.trim()
  const [result, setResult] = useState<{
    target: RuntimeClientTarget
    query: string
    projects: LinearProjectSummary[]
    error: string | null
  } | null>(null)
  useEffect(() => {
    const requestQuery = trimmed ? getLinearProjectSearchRequestQuery(trimmed) : null
    if (requestQuery === null) {
      return
    }
    // Cleanup on the next keystroke drops both the pending timer and a stale response.
    let cancelled = false
    const timer = window.setTimeout(() => {
      void linearListProjectsForTarget(target, requestQuery, PROJECT_LIMIT, 'all')
        .then((found) => ({ projects: found.items, error: null }))
        .catch((error: unknown) => ({
          projects: [],
          error: error instanceof Error ? error.message : String(error)
        }))
        .then((next) => {
          if (!cancelled) {
            setResult({ target, query: trimmed, ...next })
          }
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [target, trimmed])
  if (!trimmed) {
    return { projects: null, loading: false, error: null }
  }
  const current = result?.target === target && result.query === trimmed ? result : null
  return {
    projects: current?.projects ?? [],
    loading: current === null && getLinearProjectSearchRequestQuery(trimmed) !== null,
    error: current?.error ?? null
  }
}

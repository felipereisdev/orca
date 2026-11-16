import type { LinearProjectSummary } from '../../../shared/linear/project-types'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { linearStatusForTarget } from '@/runtime/linear/runtime-linear-client'
import { linearListProjects } from '@/runtime/linear/runtime-linear-project-client'
import {
  useProviderProjectInventory,
  type ProviderProjectInventoryRead
} from './provider-project-inventory'

// The provider's page cap: the most recently updated projects of each workspace.
const PROJECT_LIMIT = 50

async function readLinearProjects(
  target: RuntimeClientTarget
): Promise<ProviderProjectInventoryRead<LinearProjectSummary>> {
  const status = await linearStatusForTarget(target)
  return {
    connected: status.connected,
    projects: status.connected
      ? (await linearListProjects(target, undefined, PROJECT_LIMIT, 'all')).items
      : []
  }
}

export function useLinearProjectInventory(source: RuntimeClientTarget, enabled: boolean) {
  return useProviderProjectInventory(source, enabled, readLinearProjects)
}

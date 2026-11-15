import type { OrchestrationCoordinatorKey } from '../../addressing/orchestration-caller-identity'
import { isEquivalentPaneKey } from '../../db/pane-key-match'
import { OrchestrationError } from '../../orchestration-error'
import type { OrcaRuntimeService } from '../../../orca-runtime'

// A stopped coordinator never coordinates again, so its fence is never lifted; the cap bounds memory.
const MAX_FENCES = 256

// In this process only, per runtime, like the in-flight worker stops it sits beside.
const fencesByRuntime = new WeakMap<OrcaRuntimeService, OrchestrationCoordinatorKey[]>()

function sameCoordinator(a: OrchestrationCoordinatorKey, b: OrchestrationCoordinatorKey): boolean {
  return (
    (a.paneKey !== null && b.paneKey !== null && isEquivalentPaneKey(a.paneKey, b.paneKey)) ||
    (a.terminalHandle !== null && a.terminalHandle === b.terminalHandle) ||
    (a.orcaSessionId !== null && a.orcaSessionId === b.orcaSessionId)
  )
}

/** Refuses every later worker start by this coordinator: its task is being stopped. */
export function fenceCoordinator(
  runtime: OrcaRuntimeService,
  coordinator: OrchestrationCoordinatorKey
): void {
  if (!coordinator.terminalHandle && !coordinator.paneKey && !coordinator.orcaSessionId) {
    return
  }
  // A repeated ⏹ moves its fence to the newest slot instead of pushing others out of the window.
  const fences = (fencesByRuntime.get(runtime) ?? []).filter(
    (fence) =>
      fence.terminalHandle !== coordinator.terminalHandle ||
      fence.paneKey !== coordinator.paneKey ||
      fence.orcaSessionId !== coordinator.orcaSessionId
  )
  fences.push(coordinator)
  fencesByRuntime.set(runtime, fences.slice(-MAX_FENCES))
}

export function isCoordinatorFenced(
  runtime: OrcaRuntimeService,
  coordinator: OrchestrationCoordinatorKey | null
): boolean {
  return (
    coordinator !== null &&
    (fencesByRuntime.get(runtime) ?? []).some((fence) => sameCoordinator(fence, coordinator))
  )
}

/** Checked synchronously before a start binds its Run and inserts its Dispatch. */
export function refuseFencedCoordinator(
  runtime: OrcaRuntimeService,
  coordinator: OrchestrationCoordinatorKey | null
): void {
  if (isCoordinatorFenced(runtime, coordinator)) {
    throw new OrchestrationError(
      'coordinator_stopped',
      'This coordinator was stopped from the task board, so it cannot start workers. No effects were applied.',
      { effectsApplied: false }
    )
  }
}

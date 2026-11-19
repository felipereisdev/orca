import {
  RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
  type RecipeRemovalPreflight
} from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import type { RecipeRemovalAcceptedRecordings } from './recipe-removal-acks'
import { withDeadline } from './abortable-deadline'
import {
  listPendingRecordings,
  type RemovalPreflightPorts,
  type RemovalPreflightTarget
} from './workspace-removal-preflight'

/** The recordings an answer showed as lost; an unchecked answer showed nothing it could vouch for. */
export function acceptedRecordings(
  preflight: RecipeRemovalPreflight
): RecipeRemovalAcceptedRecordings {
  if (preflight.status === 'unchecked') {
    return 'unknown'
  }
  return {
    recordingIds: preflight.recordingsNotCopied.map((recording) => recording.id),
    inProgress: preflight.recordingInProgress === true
  }
}

/**
 * Right before a claim: the final list, fenced first, so no recording can start between it and the
 * claim. The claim may go on only when that list found nothing the user's answer did not show. An
 * unchecked answer the user removed anyway is only fenced, best effort.
 */
export async function recordingsAllowClaim(
  target: RemovalPreflightTarget,
  accepted: RecipeRemovalAcceptedRecordings,
  ports: RemovalPreflightPorts
): Promise<boolean> {
  if (!target.hasDesktop) {
    return true
  }
  if (accepted === 'unknown') {
    await ports.fence(target.environmentId)
    return true
  }
  const listed = await withDeadline(RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS, (signal) =>
    listPendingRecordings(target, ports, signal)
  )
  if (listed === 'timeout' || !listed.ok) {
    return false
  }
  if (listed.value.inProgress && !accepted.inProgress) {
    return false
  }
  return listed.value.recordings.every((recording) => accepted.recordingIds.includes(recording.id))
}

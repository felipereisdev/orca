import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { selectEphemeralVmWorkspaceRuntime } from '@/store/slices/ephemeral-vm/ephemeral-vm-lifecycle'
import type {
  RecipeRemovalPreflight,
  RecipeRemovalTarget
} from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

export type RecipeRemovalCheck =
  | { kind: 'skip' }
  | { kind: 'loading' }
  | { kind: 'done'; target: RecipeRemovalTarget; preflight: RecipeRemovalPreflight }

// The bridge failing is a check that couldn't run, never a clean answer.
const BRIDGE_FAILED: RecipeRemovalPreflight = {
  status: 'unchecked',
  recordingsNotCopied: [],
  dirtyFiles: 0,
  unpushedCommits: 0,
  reason: 'unreachable'
}

/**
 * Asks the host what removing this recipe workspace would lose, once per opening. Workspaces that
 * aren't recipe workspaces, or with the experiment off, `skip` the check and keep today's dialog.
 */
export function useRecipeRemovalPreflight(workspaceId: string | null): RecipeRemovalCheck {
  const enabled = useAppStore((s) => s.settings?.experimentalEphemeralVms === true)
  const runtime = useAppStore((s) =>
    workspaceId ? selectEphemeralVmWorkspaceRuntime(s, workspaceId) : null
  )
  const runtimeId = runtime?.runtimeEnvironmentId ? runtime.id : null
  const environmentId = runtime?.runtimeEnvironmentId ?? ''
  const hasDesktop = runtime?.hasDesktop === true
  const asleep = runtime?.status === 'suspended'
  const [answer, setAnswer] = useState<{
    runtimeId: string
    workspaceId: string
    preflight: RecipeRemovalPreflight | null
  } | null>(null)
  const active = enabled && workspaceId !== null && runtimeId !== null

  useEffect(() => {
    if (!active || workspaceId === null || runtimeId === null) {
      return undefined
    }
    let current = true
    void window.api.ephemeralVm
      .removalPreflight({ runtimeId, workspaceId, environmentId, hasDesktop, asleep })
      .catch(() => BRIDGE_FAILED)
      .then((preflight) => {
        if (current) {
          setAnswer({ runtimeId, workspaceId, preflight })
        }
      })
    return () => {
      current = false
      // A later opening asks again instead of showing this answer.
      setAnswer(null)
    }
  }, [active, runtimeId, workspaceId, environmentId, hasDesktop, asleep])

  if (!active || workspaceId === null || runtimeId === null) {
    return { kind: 'skip' }
  }
  if (!answer || answer.runtimeId !== runtimeId || answer.workspaceId !== workspaceId) {
    return { kind: 'loading' }
  }
  return answer.preflight
    ? {
        kind: 'done',
        target: { runtimeId, workspaceId, environmentId, hasDesktop, asleep },
        preflight: answer.preflight
      }
    : { kind: 'skip' }
}

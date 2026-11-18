import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import { onRuntimeEnvironmentStatusPublished } from '../ipc/runtime-environments/status/runtime-environment-status-owner'
import { trackRuntimeEnvironmentVerifiedTransitions } from '../ipc/runtime-environments/status/runtime-environment-verified-transitions'
import {
  configureEnvironmentDesktop,
  runtimeDesktop,
  type DesktopRuntime,
  type DesktopSettingsSource
} from './desktop-configure'
import { indexLocalRecordings } from './desktop-recording-index'
import { syncEnvironmentRecordings } from './desktop-recording-sync'

type DesktopEntry = {
  runtime: DesktopRuntime
  environmentId: string
  workspaceId?: string
  stopSync: (() => void) | null
  configuring: Promise<void> | null
}

/** One entry per recipe runtime whose desktop this host handed over. */
const entries = new Map<string, DesktopEntry>()
let detachLifecycle: (() => void) | null = null

/**
 * Configures the runtime's desktop on its environment and, once configured, keeps its recordings
 * on this Mac. Safe to repeat: a resume, reconnect or attach reconfigures from the same identity.
 */
export function startEnvironmentDesktop(
  store: DesktopSettingsSource,
  runtime: DesktopRuntime
): Promise<void> {
  const target = runtimeDesktop(store, runtime)
  if (!target) {
    return Promise.resolve()
  }
  let entry = entries.get(runtime.id)
  if (entry && entry.environmentId !== target.environmentId) {
    stopEnvironmentDesktop(runtime.id)
    entry = undefined
  }
  if (!entry) {
    entry = { runtime, environmentId: target.environmentId, stopSync: null, configuring: null }
    entries.set(runtime.id, entry)
  }
  entry.runtime = { ...runtime, workspaceId: runtime.workspaceId ?? entry.workspaceId }
  if (runtime.workspaceId && entry.workspaceId !== runtime.workspaceId) {
    entry.stopSync?.()
    entry.stopSync = null
    entry.workspaceId = runtime.workspaceId
  }
  if (entry.configuring) {
    return entry.configuring
  }
  const current = entry
  current.configuring = configureEnvironmentDesktop(target.environmentId, target.desktop).then(
    (outcome) => {
      // Cleared here, not in a later `finally`, so an attach arriving now configures again.
      current.configuring = null
      // Only the identity that configured may subscribe to the desktop's events.
      if (
        entries.get(runtime.id) === current &&
        outcome === 'configured' &&
        current.workspaceId &&
        !current.stopSync
      ) {
        current.stopSync = syncEnvironmentRecordings(target.environmentId, current.workspaceId)
      }
    }
  )
  return current.configuring
}

/** Stops the runtime's recording sync and its timers; Task 11's removal calls it too. */
export function stopEnvironmentDesktop(runtimeId: string): void {
  const entry = entries.get(runtimeId)
  if (!entry) {
    return
  }
  entries.delete(runtimeId)
  entry.stopSync?.()
  entry.stopSync = null
}

/** At startup: hands over the desktop of every recipe runtime still running. */
export function restoreEnvironmentDesktops(
  store: DesktopSettingsSource,
  runtimes: readonly (DesktopRuntime & Pick<EphemeralVmRuntimeRecord, 'status'>)[]
): void {
  for (const runtime of runtimes) {
    if (runtime.status === 'running') {
      void startEnvironmentDesktop(store, runtime)
    }
  }
}

/**
 * Follows the environments of the handed-over desktops for the app's life: a newly verified
 * environment is configured again (its server may have restarted and lost the desktop), and a
 * retired one stops its runtimes' syncs. Suspend and removal stop theirs where they happen.
 */
export function registerEnvironmentDesktopLifecycle(store: DesktopSettingsSource): void {
  detachLifecycle?.()
  void indexLocalRecordings().catch((error: unknown) => {
    console.warn('[desktop] indexing copied recordings failed', error)
  })
  const onVerified = trackRuntimeEnvironmentVerifiedTransitions((environmentId) => {
    for (const entry of entries.values()) {
      if (entry.environmentId === environmentId) {
        void startEnvironmentDesktop(store, entry.runtime)
      }
    }
  })
  detachLifecycle = onRuntimeEnvironmentStatusPublished((snapshot) => {
    if (snapshot.retired) {
      for (const [runtimeId, entry] of entries) {
        if (entry.environmentId === snapshot.environmentId) {
          stopEnvironmentDesktop(runtimeId)
        }
      }
    }
    onVerified(snapshot)
  })
}

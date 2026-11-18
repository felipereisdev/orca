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
  /** Bumped on retire, stop, suspend and removal; work begun under an older epoch has no effect. */
  epoch: number
  stopSync: (() => void) | null
  configuring: Promise<void> | null
  /** A start arrived while configuring; it may target a new pairing, so configure once more. */
  restartQueued: boolean
}

/** One entry per recipe runtime whose desktop this host handed over. */
const entries = new Map<string, DesktopEntry>()
let detachLifecycle: (() => void) | null = null

/** Ends everything the entry runs now: its sync, its configure's effects, a queued restart. */
function invalidate(entry: DesktopEntry): void {
  entry.epoch += 1
  entry.stopSync?.()
  entry.stopSync = null
  entry.configuring = null
  entry.restartQueued = false
}

function configure(
  store: DesktopSettingsSource,
  runtimeId: string,
  entry: DesktopEntry,
  target: NonNullable<ReturnType<typeof runtimeDesktop>>
): Promise<void> {
  const epoch = entry.epoch
  const current = (): boolean => entry.epoch === epoch && entries.get(runtimeId) === entry
  entry.configuring = (async () => {
    const outcome = await configureEnvironmentDesktop(target.environmentId, target.desktop)
    if (!current()) {
      return
    }
    entry.configuring = null
    if (entry.restartQueued) {
      entry.restartQueued = false
      const next = runtimeDesktop(store, entry.runtime)
      if (next) {
        await configure(store, runtimeId, entry, next)
      }
      return
    }
    // Only the identity that configured may subscribe to the desktop's events.
    if (outcome === 'configured' && entry.workspaceId && !entry.stopSync) {
      entry.stopSync = syncEnvironmentRecordings(target.environmentId, entry.workspaceId)
    }
  })()
  return entry.configuring
}

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
    entry = {
      runtime,
      environmentId: target.environmentId,
      epoch: 0,
      stopSync: null,
      configuring: null,
      restartQueued: false
    }
    entries.set(runtime.id, entry)
  }
  entry.runtime = { ...runtime, workspaceId: runtime.workspaceId ?? entry.workspaceId }
  if (runtime.workspaceId && entry.workspaceId !== runtime.workspaceId) {
    invalidate(entry)
    entry.workspaceId = runtime.workspaceId
  }
  if (entry.configuring) {
    entry.restartQueued = true
    return entry.configuring
  }
  return configure(store, runtime.id, entry, target)
}

/** Stops the runtime's recording sync and its timers; suspend, removal and Task 11 call it. */
export function stopEnvironmentDesktop(runtimeId: string): void {
  const entry = entries.get(runtimeId)
  if (!entry) {
    return
  }
  entries.delete(runtimeId)
  invalidate(entry)
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
 * retired one pauses its runtimes' syncs until it is verified again. Only suspend and removal
 * drop a runtime's entry, through `stopEnvironmentDesktop`.
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
    // Retiring is also how a re-pair under the same id swaps status owners: pause the sync but
    // keep the entry, so the next verified status configures and syncs again.
    if (snapshot.retired) {
      for (const entry of entries.values()) {
        if (entry.environmentId === snapshot.environmentId) {
          invalidate(entry)
        }
      }
    }
    onVerified(snapshot)
  })
}

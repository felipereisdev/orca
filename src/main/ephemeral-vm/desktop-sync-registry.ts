import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import { getRuntimeEnvironmentStatusSnapshot } from '../ipc/runtime-environments/connections/runtime-environment-request-connections'
import { onRuntimeEnvironmentStatusPublished } from '../ipc/runtime-environments/status/runtime-environment-status-owner'
import { trackRuntimeEnvironmentVerifiedTransitions } from '../ipc/runtime-environments/status/runtime-environment-verified-transitions'
import {
  configureEnvironmentDesktop,
  runtimeDesktop,
  type DesktopConfigureRetry,
  type DesktopRuntime,
  type DesktopSettingsSource
} from './desktop-configure'
import { indexLocalRecordings } from './desktop-recording-index'
import { syncEnvironmentRecordings } from './desktop-recording-sync'

const RETRY_FIRST_DELAY_MS = 2_000
const RETRY_MAX_DELAY_MS = 30_000
const RETRY_BUDGET_MS = 5 * 60_000

/** A failed configure tried again on a self-rescheduling timeout, while the entry stays current. */
type ConfigureRetry = {
  timer: ReturnType<typeof setTimeout> | null
  nextDelayMs: number
  deadline: number
  authRetried: boolean
}

function freshRetry(): ConfigureRetry {
  return {
    timer: null,
    nextDelayMs: RETRY_FIRST_DELAY_MS,
    deadline: performance.now() + RETRY_BUDGET_MS,
    authRetried: false
  }
}

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
  /** The newest configure's controller token; in memory only, gone with the entry. */
  controllerToken: string | null
  retry: ConfigureRetry
  retryPaused: boolean
}

/** One entry per recipe runtime whose desktop this host handed over. */
const entries = new Map<string, DesktopEntry>()
let detachLifecycle: (() => void) | null = null

/** Ends everything the entry runs now: its sync, its configure's effects, a queued restart. */
function invalidate(entry: DesktopEntry): void {
  resetRetry(entry)
  entry.epoch += 1
  entry.stopSync?.()
  entry.stopSync = null
  entry.configuring = null
  entry.restartQueued = false
}

function resetRetry(entry: DesktopEntry): void {
  if (entry.retry.timer) {
    clearTimeout(entry.retry.timer)
  }
  entry.retry = freshRetry()
}

/** VNC may still be starting while the environment stays verified: no transition would come. */
function scheduleRetry(
  store: DesktopSettingsSource,
  runtimeId: string,
  entry: DesktopEntry,
  kind: DesktopConfigureRetry
): void {
  const { retry, epoch } = entry
  const delay = retry.nextDelayMs
  if (entry.retryPaused || retry.timer || performance.now() + delay >= retry.deadline) {
    return
  }
  if (kind === 'auth') {
    if (retry.authRetried) {
      return
    }
    retry.authRetried = true
  }
  retry.nextDelayMs = Math.min(delay * 2, RETRY_MAX_DELAY_MS)
  retry.timer = setTimeout(() => {
    retry.timer = null
    const target = runtimeDesktop(store, entry.runtime)
    if (
      performance.now() < retry.deadline &&
      !entry.retryPaused &&
      entry.epoch === epoch &&
      entries.get(runtimeId) === entry &&
      !entry.configuring &&
      target
    ) {
      void configure(store, runtimeId, entry, target)
    }
  }, delay)
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
    const configured = await configureEnvironmentDesktop(target.environmentId, target.desktop)
    if (!current()) {
      return
    }
    entry.configuring = null
    // A failed configure leaves the broker as it was, so the token it last gave stays good.
    if (configured.outcome === 'configured') {
      entry.controllerToken = configured.controllerToken
      resetRetry(entry)
    }
    if (entry.restartQueued) {
      entry.restartQueued = false
      const next = runtimeDesktop(store, entry.runtime)
      if (next) {
        resetRetry(entry)
        await configure(store, runtimeId, entry, next)
      }
      return
    }
    if (configured.outcome === 'failed' && configured.retry) {
      scheduleRetry(store, runtimeId, entry, configured.retry)
    }
    // Only the identity that configured may subscribe to the desktop's events.
    if (configured.outcome === 'configured' && entry.workspaceId && !entry.stopSync) {
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
    const status = getRuntimeEnvironmentStatusSnapshot(target.environmentId)
    entry = {
      runtime,
      environmentId: target.environmentId,
      epoch: 0,
      stopSync: null,
      configuring: null,
      restartQueued: false,
      controllerToken: null,
      retry: freshRetry(),
      retryPaused:
        status !== null && (status.retired === true || status.verification !== 'verified')
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
  // A start (resume, verified again, Retry) configures now and begins any backoff anew.
  resetRetry(entry)
  return configure(store, runtime.id, entry, target)
}

/** The token the environment's broker gave this host's newest configure; null when none. */
export function desktopControllerToken(environmentId: string): string | null {
  for (const entry of entries.values()) {
    if (entry.environmentId === environmentId && entry.controllerToken) {
      return entry.controllerToken
    }
  }
  return null
}

/**
 * Runs the configure again for every runtime on the environment (the Desktop tab's Retry, or a
 * refused token after the broker restarted); true when a controller token is held afterwards.
 */
export async function reconfigureEnvironmentDesktop(
  store: DesktopSettingsSource,
  environmentId: string
): Promise<boolean> {
  const runtimes = [...entries.values()]
    .filter((entry) => entry.environmentId === environmentId)
    .map((entry) => entry.runtime)
  await Promise.all(runtimes.map((runtime) => startEnvironmentDesktop(store, runtime)))
  return desktopControllerToken(environmentId) !== null
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
    for (const entry of entries.values()) {
      if (entry.environmentId !== snapshot.environmentId) {
        continue
      }
      entry.retryPaused = snapshot.retired === true || snapshot.verification !== 'verified'
      if (snapshot.retired) {
        invalidate(entry)
      } else if (entry.retryPaused) {
        resetRetry(entry)
        entry.restartQueued = false
      }
    }
    onVerified(snapshot)
  })
}

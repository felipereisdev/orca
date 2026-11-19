import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEphemeralVmRecipeResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type { RuntimeHostStatusSnapshot } from '../../shared/remote-runtime/host-status/runtime-host-status'
import { desktopEnvironmentFake as env } from './desktop-environment-fake.test-support'
import type * as RecordingIndex from './desktop-recording-index'

type StatusListener = (snapshot: RuntimeHostStatusSnapshot) => void
const state = vi.hoisted(() => {
  const statusListeners: StatusListener[] = []
  return { statusListeners }
})

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', async () =>
  (await import('./desktop-environment-fake.test-support')).fakeTransportRoutingModule()
)
vi.mock('../ipc/runtime-environments/status/runtime-environment-status-owner', () => ({
  onRuntimeEnvironmentStatusPublished: (listener: StatusListener) => {
    state.statusListeners.push(listener)
    return () => {}
  }
}))
vi.mock('./desktop-recording-index', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordingIndex>()),
  indexLocalRecordings: async () => {}
}))

import {
  desktopControllerToken,
  reconfigureEnvironmentDesktop,
  registerEnvironmentDesktopLifecycle,
  restoreEnvironmentDesktops,
  stopEnvironmentDesktop
} from './desktop-sync-registry'

const STORE = { getSettings: () => ({ experimentalEphemeralVms: true }) }

function runningRuntime(): EphemeralVmRuntimeRecord {
  const parsed = parseEphemeralVmRecipeResult(
    JSON.stringify({
      schemaVersion: 1,
      connection: {
        type: 'ssh',
        projectRoot: '/workspace/repo',
        target: { label: 'VM', host: 'vm.example.com', port: 22, username: 'root' }
      },
      desktop: { type: 'vnc', port: 5901, password: 'abc12345' }
    })
  )
  if (!parsed.ok) {
    throw new Error('fixture recipe result did not parse')
  }
  return {
    id: 'vm-1',
    recipeId: 'cloud',
    repoId: 'repo-1',
    status: 'running',
    cleanupStatus: 'not_started',
    connectionMode: 'ssh',
    runtimeEnvironmentId: 'env-1',
    workspaceId: 'repo-1::/workspace/repo',
    recipeResult: parsed.result,
    createdAt: 0,
    updatedAt: 0
  }
}

function configureCalls(): number {
  return env.methods().filter((method) => method === 'desktop.configure').length
}

function verified(environmentId: string, retired = false): RuntimeHostStatusSnapshot {
  return {
    environmentId,
    pairingRevision: 1,
    sequence: 1,
    checkedAt: 0,
    status: null,
    verification: 'verified',
    transport: 'ready',
    ...(retired ? { retired: true as const } : {})
  }
}

/** Lets pending promises finish, so an assertion that nothing happened means it. */
async function settle(turns = 50): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

/** Holds every configure answer until the returned release is called. */
function holdConfigures(): () => void {
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  env.configure = async () => {
    await gate
    return env.configuredReply()
  }
  return release
}

function publish(snapshot: RuntimeHostStatusSnapshot): void {
  state.statusListeners.forEach((listener) => listener(snapshot))
}

describe('desktop hand-off lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    stopEnvironmentDesktop('vm-1')
    vi.useRealTimers()
    state.statusListeners.splice(0)
    env.reset()
  })

  async function restored(): Promise<void> {
    registerEnvironmentDesktopLifecycle(STORE)
    restoreEnvironmentDesktops(STORE, [
      runningRuntime(),
      { ...runningRuntime(), id: 'vm-2', status: 'suspended', runtimeEnvironmentId: 'env-2' }
    ])
    await vi.waitFor(() => expect(env.streams).toHaveLength(1))
  }

  it('restores a running desktop workspace at startup', async () => {
    await restored()

    // Only the running runtime is handed over; the suspended one waits for its resume.
    expect(env.calls.filter((call) => call.method === 'desktop.configure')).toEqual([
      expect.objectContaining({ environmentId: 'env-1' })
    ])
  })

  it('reconfigures when the environment is verified again', async () => {
    await restored()
    state.statusListeners.forEach((listener) => listener(verified('env-1')))

    await vi.waitFor(() => expect(configureCalls()).toBe(2))
    // The recording sync already running is kept, not doubled.
    expect(env.streams).toHaveLength(1)
  })

  it('stops the sync when its environment is retired', async () => {
    await restored()

    state.statusListeners.forEach((listener) => listener(verified('env-1', true)))
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(env.closedStreams).toBe(1)
    expect(env.streams).toHaveLength(1)
  })

  it('retiring while a configure is in flight starts no sync until the next verified status', async () => {
    const release = holdConfigures()
    registerEnvironmentDesktopLifecycle(STORE)
    restoreEnvironmentDesktops(STORE, [runningRuntime()])
    await settle()
    expect(configureCalls()).toBe(1)

    publish(verified('env-1', true))
    release()
    await settle()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(env.streams).toHaveLength(0)

    publish(verified('env-1'))
    await settle()
    expect(configureCalls()).toBe(2)
    expect(env.streams).toHaveLength(1)
  })

  it('retiring with a queued restart pending starts no sync', async () => {
    const release = holdConfigures()
    registerEnvironmentDesktopLifecycle(STORE)
    restoreEnvironmentDesktops(STORE, [runningRuntime()])
    await settle()
    // Verified while the first configure is out: one more configure is queued after it.
    publish(verified('env-1'))
    publish(verified('env-1', true))
    release()
    await settle()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(configureCalls()).toBe(1)
    expect(env.streams).toHaveLength(0)
  })

  it('an environment verified again after retiring gets its desktop and sync back', async () => {
    await restored()
    state.statusListeners.forEach((listener) => listener(verified('env-1')))
    await vi.waitFor(() => expect(configureCalls()).toBe(2))

    // Re-pairing under the same id retires the old status owner, then verifies the new one.
    state.statusListeners.forEach((listener) => listener(verified('env-1', true)))
    expect(env.closedStreams).toBe(1)
    state.statusListeners.forEach((listener) => listener(verified('env-1')))

    await vi.waitFor(() => expect(configureCalls()).toBe(3))
    await vi.waitFor(() => expect(env.streams).toHaveLength(2))
  })

  it('keeps the controller token in memory and takes the new one after a broker restart', async () => {
    await restored()
    expect(desktopControllerToken('env-1')).toBe('controller-token-1')

    // The environment's server restarted and was verified again: its broker forgot every token.
    publish(verified('env-1'))
    await vi.waitFor(() => expect(desktopControllerToken('env-1')).toBe('controller-token-2'))
    expect(configureCalls()).toBe(2)
    stopEnvironmentDesktop('vm-1')
    expect(desktopControllerToken('env-1')).toBeNull()
  })

  it('a retry configures a still-connected environment again after a transient failure', async () => {
    registerEnvironmentDesktopLifecycle(STORE)
    env.configure = () => ({
      id: 'r',
      ok: false,
      error: { code: 'desktop_unavailable', message: 'VNC still starting' }
    })
    restoreEnvironmentDesktops(STORE, [runningRuntime()])
    await vi.waitFor(() => expect(configureCalls()).toBe(1))
    await settle()
    expect(desktopControllerToken('env-1')).toBeNull()
    expect(env.streams).toHaveLength(0)

    env.configure = () => env.configuredReply()
    await expect(reconfigureEnvironmentDesktop(STORE, 'env-1')).resolves.toBe(true)

    expect(configureCalls()).toBe(2)
    expect(desktopControllerToken('env-1')).toBe('controller-token-1')
    await vi.waitFor(() => expect(env.streams).toHaveLength(1))
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeHostStatusSnapshot } from '../../shared/remote-runtime/host-status/runtime-host-status'
import {
  desktopEnvironmentFake as env,
  runningDesktopRuntimeFixture as runningRuntime
} from './desktop-environment-fake.test-support'
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
  startEnvironmentDesktop,
  stopEnvironmentDesktop
} from './desktop-sync-registry'

const STORE = { getSettings: () => ({ experimentalEphemeralVms: true }) }

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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
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

  /** The broker's answer while Xvnc is not listening yet, or refuses the password. */
  function vncFailure(reason: 'desktop_vnc_unreachable' | 'rfb_auth_failed') {
    return {
      id: 'r',
      ok: false as const,
      error: { code: 'desktop_unavailable', message: 'unavailable', data: { reason } }
    }
  }

  it('keeps configuring while VNC is still starting, with no Retry and no transition', async () => {
    registerEnvironmentDesktopLifecycle(STORE)
    let failures = 3
    env.configure = () =>
      failures-- > 0 ? vncFailure('desktop_vnc_unreachable') : env.configuredReply()
    restoreEnvironmentDesktops(STORE, [runningRuntime()])

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()

    expect(configureCalls()).toBe(4)
    expect(desktopControllerToken('env-1')).toBe('controller-token-1')
    await vi.waitFor(() => expect(env.streams).toHaveLength(1))
    // Configured: nothing is retried any more.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(configureCalls()).toBe(4)
  })

  it.each([
    { reason: 'stopping the desktop', stop: () => stopEnvironmentDesktop('vm-1') },
    {
      reason: 'unavailable transition',
      stop: () => publish({ ...verified('env-1'), verification: 'unavailable' })
    }
  ])('$reason cancels the retries', async ({ stop }) => {
    registerEnvironmentDesktopLifecycle(STORE)
    publish(verified('env-1'))
    env.configure = () => vncFailure('desktop_vnc_unreachable')
    await startEnvironmentDesktop(STORE, runningRuntime())

    env.configure = () => env.configuredReply()
    stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(desktopControllerToken('env-1')).toBeNull()
  })

  it('slow configure RPCs count toward the five-minute retry budget', async () => {
    registerEnvironmentDesktopLifecycle(STORE)
    publish(verified('env-1'))
    let pending = Promise.withResolvers<void>()
    env.configure = async () => {
      await pending.promise
      return vncFailure('desktop_vnc_unreachable')
    }
    const starting = startEnvironmentDesktop(STORE, runningRuntime())
    await vi.advanceTimersByTimeAsync(149_000)
    pending.resolve()
    await starting

    pending = Promise.withResolvers<void>()
    await vi.advanceTimersByTimeAsync(151_000)
    expect(configureCalls()).toBe(2)
    env.configure = () => env.configuredReply()
    pending.resolve()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(desktopControllerToken('env-1')).toBeNull()
  })

  it('a refused VNC password is tried once more, never in a loop', async () => {
    registerEnvironmentDesktopLifecycle(STORE)
    env.configure = () => vncFailure('rfb_auth_failed')
    restoreEnvironmentDesktops(STORE, [runningRuntime()])

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await settle()

    expect(configureCalls()).toBe(2)
  })
})

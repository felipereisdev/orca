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
})

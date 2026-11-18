import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEphemeralVmRecipeResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { desktopEnvironmentFake as env } from './desktop-environment-fake.test-support'

const mocks = vi.hoisted(() => ({ suspend: vi.fn() }))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', async () =>
  (await import('./desktop-environment-fake.test-support')).fakeTransportRoutingModule()
)
vi.mock('../ipc/runtime-environments/status/runtime-environment-status-owner', () => ({
  onRuntimeEnvironmentStatusPublished: () => () => {}
}))
vi.mock('../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-workspace-runtime', () => ({
  findWorkspaceEphemeralVmRuntime: () => ({
    id: 'vm-1',
    status: 'running',
    connectionMode: 'orca-server',
    runtimeEnvironmentId: 'env-1'
  })
}))
vi.mock('../ipc/ephemeral-vm/ephemeral-vm-recipe-context', () => ({
  getRuntimeRecipeContext: () => ({ repoPath: '/repo', recipe: { suspend: './suspend.sh' } })
}))
vi.mock('./runtime-service', () => ({ suspendEphemeralVmRuntime: mocks.suspend }))
vi.mock('./runtime-ssh', () => ({ disconnectRuntimeOwnedSshTarget: vi.fn() }))

import type { Store } from '../persistence/loading-store/store'
import { startEnvironmentDesktop } from './desktop-sync-registry'
import { suspendEphemeralVmWorkspace } from './workspace-suspend'

const SETTINGS = { getSettings: () => ({ experimentalEphemeralVms: true }) }
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: suspend only hands the store to the mocked recipe context reader.
const STORE = SETTINGS as unknown as Store

describe('suspending a recipe workspace with a desktop', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    mocks.suspend.mockReset()
    env.reset()
  })

  it('stops the recording sync and its timers', async () => {
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
    await startEnvironmentDesktop(SETTINGS, {
      id: 'vm-1',
      runtimeEnvironmentId: 'env-1',
      workspaceId: 'repo-1::/workspace/repo',
      recipeResult: parsed.result
    })
    expect(env.streams).toHaveLength(1)
    mocks.suspend.mockResolvedValue({ ok: true, skipped: false, runtime: {} })

    await suspendEphemeralVmWorkspace(STORE, 'repo-1::/workspace/repo')
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(env.closedStreams).toBe(1)
    expect(env.streams).toHaveLength(1)
  })
})

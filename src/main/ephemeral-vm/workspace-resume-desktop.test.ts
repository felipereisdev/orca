import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEphemeralVmRecipeResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { encodePairingOffer } from '../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'

const mocks = vi.hoisted(() => {
  const record: Record<string, unknown> = {}
  return {
    resume: vi.fn(),
    call: vi.fn(
      async (_root: string, _environmentId: string, _method: string, _params: unknown) => ({
        id: 'r',
        ok: true,
        result: {},
        _meta: { runtimeId: 'vm' }
      })
    ),
    subscribe: vi.fn(async () => ({ close: () => {} })),
    record
  }
})

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store', () => ({
  updateEphemeralVmRuntimeStatus: vi.fn(
    (_userDataPath: string, _id: string, patch: Record<string, unknown>) => patch
  )
}))
vi.mock('../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-workspace-runtime', () => ({
  findWorkspaceEphemeralVmRuntime: () => mocks.record
}))
vi.mock('../ipc/ephemeral-vm/ephemeral-vm-recipe-context', () => ({
  getRuntimeRecipeContext: () => ({ repoPath: '/repo', recipe: { resume: './resume.sh' } })
}))
vi.mock('../ipc/runtime-environments/runtime-environments', () => ({
  invalidateRuntimeEnvironmentTransport: vi.fn()
}))
vi.mock('../ipc/runtime-environments/connections/runtime-environment-request-connections', () => ({
  getRuntimeEnvironmentStatusSnapshot: () => null,
  getRuntimeEnvironmentStatusOwner: () => ({ refresh: async () => ({}) }),
  reconnectRemoteRuntimeSharedControlConnection: vi.fn(),
  getRemoteRuntimeSharedControlDiagnostics: () => null
}))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.call,
  subscribeRuntimeEnvironment: mocks.subscribe
}))
vi.mock('../ipc/runtime-environments/status/runtime-environment-status-owner', () => ({
  onRuntimeEnvironmentStatusPublished: () => () => {}
}))
vi.mock('../ssh/targets/ssh-target-registry', () => ({ getRegisteredSshState: () => undefined }))
vi.mock('./runtime-service', () => ({ resumeEphemeralVmRuntime: mocks.resume }))
vi.mock('./runtime-ssh', () => ({
  connectRuntimeOwnedSshTarget: vi.fn(),
  refreshRuntimeOwnedSshTarget: vi.fn()
}))

import type { Store } from '../persistence/loading-store/store'
import { resumeEphemeralVmWorkspace } from './workspace-resume'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resume only reads settings from this store; the recipe context reader is mocked.
const STORE = { getSettings: () => ({ experimentalEphemeralVms: true }) } as unknown as Store

const PAIRING_CODE = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'wss://vm.example.com',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key'
})

describe('resuming a recipe workspace with a desktop', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    mocks.call.mockClear()
    mocks.resume.mockReset()
  })

  it('resume reconfigures the desktop', async () => {
    const parsed = parseEphemeralVmRecipeResult(
      JSON.stringify({
        schemaVersion: 1,
        connection: { type: 'orca-server', pairingCode: PAIRING_CODE, projectRoot: '/w' },
        desktop: { type: 'vnc', port: 5901, password: 'abc12345' }
      })
    )
    if (!parsed.ok) {
      throw new Error('fixture recipe result did not parse')
    }
    mocks.record = {
      id: 'vm-1',
      status: 'suspended',
      connectionMode: 'orca-server',
      runtimeEnvironmentId: 'env-1',
      workspaceId: 'ws-1'
    }
    mocks.resume.mockResolvedValue({
      ok: true,
      skipped: true,
      runtime: { ...mocks.record, status: 'running', recipeResult: parsed.result }
    })

    await resumeEphemeralVmWorkspace(STORE, 'ws-1', { sshHeld: false, sshUserDisconnects: 0 })
    await vi.runOnlyPendingTimersAsync()

    await vi.waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        '/user-data',
        'env-1',
        'desktop.configure',
        { host: '127.0.0.1', port: 5901, password: 'abc12345' },
        expect.anything()
      )
    )
  })
})

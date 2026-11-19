import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTempDirs } from '../../../shared/testing/remove-temp-dirs.test-support'
import { afterEach, expect, it, vi } from 'vitest'
import type * as OrcaYamlAsyncReadModule from '../../workspace-hooks/orca-yaml-async-read'

const handlers = new Map<string, (_event: unknown, args: never) => unknown>()
const { getPathMock, handleMock, resolveProvisionedRootSourceMock, loadHooksAsyncMock } =
  vi.hoisted(() => ({
    getPathMock: vi.fn(),
    handleMock: vi.fn(),
    resolveProvisionedRootSourceMock: vi.fn(),
    loadHooksAsyncMock: vi.fn()
  }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: getPathMock },
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))

vi.mock('../../ephemeral-vm/provisioned-root-source', () => ({
  resolveProvisionedRootSource: resolveProvisionedRootSourceMock
}))

vi.mock('../../workspace-hooks/orca-yaml-async-read', async (importOriginal) => {
  const actual = await importOriginal<typeof OrcaYamlAsyncReadModule>()
  loadHooksAsyncMock.mockImplementation(actual.loadHooksAsync)
  return { loadHooksAsync: loadHooksAsyncMock }
})

import { registerEphemeralVmHandlers } from './ephemeral-vm'

const tempDirs: string[] = []

afterEach(async () => {
  await removeTempDirs(tempDirs.splice(0))
  vi.clearAllMocks()
})

it('cancels during the recipe approval read before anything is created', async () => {
  const userDataPath = makeTempDir('orca-vm-cancel-user-data-')
  const repoPath = makeTempDir('orca-vm-cancel-repo-')
  const createMarker = join(repoPath, 'create-ran')
  getPathMock.mockReturnValue(userDataPath)
  handleMock.mockImplementation((channel: string, handler: never) => handlers.set(channel, handler))
  writeRecipe(repoPath, createMarker)
  const realRead = loadHooksAsyncMock.getMockImplementation()
  let finishRead: () => void = () => {}
  loadHooksAsyncMock.mockImplementationOnce(
    (path: string) =>
      new Promise((resolve) => {
        finishRead = () => resolve(realRead?.(path))
      })
  )
  registerEphemeralVmHandlers(makeStore(repoPath) as never)

  const provision = Promise.resolve(
    handlers.get('ephemeralVm:provision')?.(
      null,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases the provision handler's argument type.
      {
        repoId: 'repo-1',
        recipeId: 'cloud-sandbox',
        provisionId: 'provision-approval-read'
      } as never
    )
  )
  await vi.waitFor(() => expect(loadHooksAsyncMock).toHaveBeenCalledOnce())
  const cancelled = await handlers.get('ephemeralVm:cancelProvision')?.(
    null,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases the cancel handler's argument type.
    { provisionId: 'provision-approval-read' } as never
  )
  finishRead()
  const result = await provision

  expect(cancelled).toEqual({ cancelled: true })
  expect(result).toMatchObject({ ok: false, errorCode: 'provisionCancelled' })
  expect(resolveProvisionedRootSourceMock).not.toHaveBeenCalled()
  expect(existsSync(createMarker)).toBe(false)
})

it('cancels source resolution before a provisioned-root recipe creates resources', async () => {
  const userDataPath = makeTempDir('orca-vm-cancel-user-data-')
  const repoPath = makeTempDir('orca-vm-cancel-repo-')
  const createMarker = join(repoPath, 'create-ran')
  getPathMock.mockReturnValue(userDataPath)
  handleMock.mockImplementation((channel: string, handler: never) => handlers.set(channel, handler))
  writeRecipe(repoPath, createMarker)
  resolveProvisionedRootSourceMock.mockImplementation(
    (_store, _repo, _ref, signal: AbortSignal | undefined) =>
      new Promise((resolve) =>
        signal?.addEventListener('abort', () => resolve(null), { once: true })
      )
  )
  registerEphemeralVmHandlers(makeStore(repoPath) as never)

  const provision = handlers.get('ephemeralVm:provision')?.(null, {
    repoId: 'repo-1',
    recipeId: 'cloud-sandbox',
    provisionId: 'provision-source-ref'
  } as never) as Promise<{ ok: boolean; error?: string }>
  await vi.waitFor(() => expect(resolveProvisionedRootSourceMock).toHaveBeenCalledOnce())
  const cancelled = await handlers.get('ephemeralVm:cancelProvision')?.(null, {
    provisionId: 'provision-source-ref'
  } as never)
  const result = await provision

  expect(cancelled).toEqual({ cancelled: true })
  expect(result).toEqual({
    ok: false,
    error: 'Provisioning cancelled.',
    errorCode: 'provisionCancelled',
    stdout: '',
    stderr: ''
  })
  expect(existsSync(createMarker)).toBe(false)
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeStore(repoPath: string) {
  const repo = { id: 'repo-1', path: repoPath, displayName: 'Repo', addedAt: 0 }
  return {
    getRepo: vi.fn((id: string) => (id === repo.id ? repo : null)),
    getRepos: vi.fn(() => [repo]),
    getSettings: vi.fn(() => ({ activeRuntimeEnvironmentId: null })),
    // Repo-wide trust: the approval binding has its own tests.
    getUI: vi.fn(() => ({ trustedOrcaHooks: { [repo.id]: { all: { approvedAt: 0 } } } }))
  }
}

function writeRecipe(repoPath: string, createMarker: string): void {
  writeFileSync(
    join(repoPath, 'orca.yaml'),
    [
      'environmentRecipes:',
      '  - id: cloud-sandbox',
      '    name: Cloud Sandbox',
      '    checkoutMode: provisioned-root',
      `    create: ${JSON.stringify(`"${process.execPath}" -e "require('node:fs').writeFileSync('${createMarker}','x')"`)}`,
      '    destroy: none'
    ].join('\n')
  )
}

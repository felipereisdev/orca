import '../../../shared/remote-runtime/host-store/environment-store-worker-test-fixture'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempDirs } from '../../../shared/testing/remove-temp-dirs.test-support'
import { listEphemeralVmRuntimes } from '../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import { getEphemeralVmRuntimeFeatureStorePath } from '../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-feature-store'
import { parseOrcaYaml } from '../../../shared/workspace-setup/orca-yaml'
import { getVmRecipeTrustContent } from '../../../shared/workspace-setup/hooks/vm-recipe-trust-content'

const handlers = new Map<string, (_event: unknown, args: never) => unknown>()
const { getPathMock, handleMock } = vi.hoisted(() => ({
  getPathMock: vi.fn(),
  handleMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: getPathMock },
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))

vi.mock('../../ephemeral-vm/runtime-ssh', () => ({
  connectRuntimeOwnedSshTarget: vi.fn(async () => ({
    targetId: 'runtime-ssh-env',
    target: { id: 'runtime-ssh-env', label: 'env', host: '127.0.0.1', port: 2222, username: 'dev' }
  })),
  disconnectRuntimeOwnedSshTarget: vi.fn(async () => undefined),
  removeRuntimeOwnedSshTarget: vi.fn(async () => undefined)
}))

import { registerEphemeralVmHandlers } from './ephemeral-vm'

const tempDirs: string[] = []

beforeEach(() => {
  handlers.clear()
  handleMock.mockImplementation((channel: string, handler: never) => handlers.set(channel, handler))
})
afterEach(async () => {
  await removeTempDirs(tempDirs.splice(0))
  vi.clearAllMocks()
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** The vmRecipe trust hash the renderer's approval carries: SHA-256 hex of the trimmed content. */
function approvedHashOf(yaml: string): string {
  const content = getVmRecipeTrustContent(parseOrcaYaml(yaml))
  return createHash('sha256').update(content.trim()).digest('hex')
}

function setup(repoWideTrust = false) {
  const userDataPath = makeTempDir('orca-vm-approval-data-')
  const repoPath = makeTempDir('orca-vm-approval-repo-')
  getPathMock.mockReturnValue(userDataPath)
  const marker = (name: string): string => join(repoPath, `${name}-ran`)
  // Script files keep native (Windows) paths out of shell and JavaScript quoting.
  const script = (name: string): string => {
    const file = join(repoPath, `${name}.js`)
    writeFileSync(
      file,
      `require('node:fs').writeFileSync(${JSON.stringify(marker(name))}, 'x')\n` +
        `process.stdout.write(${JSON.stringify(
          JSON.stringify({
            schemaVersion: 1,
            connection: {
              type: 'ssh',
              target: { label: 'env', host: '127.0.0.1', port: 2222, username: 'dev' },
              projectRoot: '/w'
            }
          })
        )})\n`
    )
    return `"${process.execPath}" "${file}"`
  }
  const yaml = (create: string, stats: string, description?: string): string =>
    [
      'environmentRecipes:',
      '  - id: docker',
      '    name: Docker',
      ...(description === undefined ? [] : [`    description: ${JSON.stringify(description)}`]),
      `    create: ${JSON.stringify(create.startsWith('"') ? create : script(create))}`,
      `    stats: ${JSON.stringify(script(stats))}`,
      '    destroy: none'
    ].join('\n')
  const repo = { id: 'repo-1', path: repoPath, displayName: 'Repo', addedAt: 0 }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: provisioning reads only these store methods.
  registerEphemeralVmHandlers({
    getRepo: vi.fn((id: string) => (id === repo.id ? repo : null)),
    getRepos: vi.fn(() => [repo]),
    getSettings: vi.fn(() => ({
      activeRuntimeEnvironmentId: null,
      experimentalEphemeralVms: true
    })),
    getUI: vi.fn(() => ({
      trustedOrcaHooks: repoWideTrust ? { 'repo-1': { all: { approvedAt: 1 } } } : {}
    }))
  } as never)
  const writeYaml = (text: string): void => writeFileSync(join(repoPath, 'orca.yaml'), text)
  const provision = async (approvedRecipeHash?: string): Promise<unknown> =>
    handlers.get('ephemeralVm:provision')?.(
      null,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler map erases the provision handler's argument type.
      {
        repoId: 'repo-1',
        recipeId: 'docker',
        ...(approvedRecipeHash ? { approvedRecipeHash } : {})
      } as never
    )
  const sidecarText = (): string => {
    const path = getEphemeralVmRuntimeFeatureStorePath(userDataPath)
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  }
  return { userDataPath, yaml, writeYaml, provision, marker, sidecarText, script }
}

describe('ephemeralVm:provision approval binding', () => {
  it('refuses a recipe that changed after approval: nothing is created or captured', async () => {
    const env = setup()
    const approved = env.yaml('create', 'stats')
    env.writeYaml(approved)
    const hash = approvedHashOf(approved)
    env.writeYaml(env.yaml('create', 'sneaky-stats'))

    await expect(env.provision(hash)).resolves.toMatchObject({
      ok: false,
      errorCode: 'recipe_changed_since_approval'
    })
    await expect(env.provision()).resolves.toMatchObject({
      ok: false,
      errorCode: 'recipe_changed_since_approval'
    })
    expect(existsSync(env.marker('create'))).toBe(false)
    expect(listEphemeralVmRuntimes(env.userDataPath)).toEqual([])
    expect(env.sidecarText()).not.toContain('sneaky-stats')
  })

  it('provisions the approved recipe, and repo-wide trust needs no hash', async () => {
    const env = setup()
    const approved = env.yaml('create', 'stats')
    env.writeYaml(approved)
    await expect(env.provision(approvedHashOf(approved))).resolves.toMatchObject({ ok: true })
    expect(env.sidecarText()).toContain('stats.js')

    const trusted = setup(true)
    trusted.writeYaml(trusted.yaml('create', 'stats'))
    await expect(trusted.provision()).resolves.toMatchObject({ ok: true })
  })

  it('a newline moved across a field boundary changes the hash and is refused', async () => {
    const env = setup()
    const real = env.script('create')
    // The old line-joined trust text read the same for both: "description: d\ncreate: <real>\n…".
    const approved = env.yaml(real, 'stats', `d\ncreate: ${real}`)
    const swapped = env.yaml(`${real}\ncreate: ${real}`, 'stats', 'd')
    env.writeYaml(approved)
    const hash = approvedHashOf(approved)
    expect(approvedHashOf(swapped)).not.toBe(hash)
    env.writeYaml(swapped)

    await expect(env.provision(hash)).resolves.toMatchObject({
      ok: false,
      errorCode: 'recipe_changed_since_approval'
    })
    expect(existsSync(env.marker('create'))).toBe(false)
  })
})

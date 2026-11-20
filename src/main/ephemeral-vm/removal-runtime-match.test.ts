import '../../shared/remote-runtime/host-store/environment-store-worker-test-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { upsertEphemeralVmRuntime } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtime-store'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import { listRuntimesForRemoval } from './removal-runtime-match'

let root: string

function seed(record: Partial<EphemeralVmRuntimeRecord> & { id: string }): void {
  upsertEphemeralVmRuntime(root, {
    recipeId: 'cloud',
    repoId: 'repo',
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: 1,
    updatedAt: 1,
    ...record
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-removal-match-'))
})
afterEach(() => removeTempDirs([root]))

it('main picks the records a removal destroys, by SSH target, workspace or host', async () => {
  seed({ id: 'vm-target', sshTargetId: 'runtime-ssh-a' })
  seed({ id: 'vm-other-target', sshTargetId: 'runtime-ssh-b' })
  seed({ id: 'vm-plain-target', sshTargetId: 'plain-target' })
  seed({ id: 'vm-workspace', workspaceId: 'repo::/w', runtimeEnvironmentId: 'env-a' })
  seed({
    id: 'vm-workspace-done',
    workspaceId: 'repo::/w',
    runtimeEnvironmentId: 'env-a',
    cleanupStatus: 'succeeded'
  })
  seed({ id: 'vm-scoped', workspaceId: 'repo::/x', runtimeEnvironmentId: 'env-b' })
  seed({ id: 'vm-scoped-twin', workspaceId: 'repo::/x', runtimeEnvironmentId: 'env-c' })

  const matched = await listRuntimesForRemoval(root, {
    workspaceIds: ['repo::/w'],
    hostScopedWorkspaces: [{ workspaceId: 'repo::/x', executionHostId: 'runtime:env-b' }],
    // Only runtime-owned targets name a recipe VM.
    runtimeOwnedSshTargetIds: ['runtime-ssh-a', 'plain-target']
  })
  expect(matched.map((runtime) => runtime.id).sort()).toEqual([
    'vm-scoped',
    'vm-target',
    'vm-workspace'
  ])
})

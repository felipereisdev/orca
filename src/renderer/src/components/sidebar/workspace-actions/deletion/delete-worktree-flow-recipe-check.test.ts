// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import type { RecipeRemovalCheckResult } from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

const mocks = vi.hoisted(() => ({
  deleteWithToast: vi.fn(async () => {}),
  deleteInParallel: vi.fn(async () => [])
}))
vi.mock('./run-worktree-delete-with-toast', () => ({
  runWorktreeDeleteWithToast: mocks.deleteWithToast
}))
vi.mock('./worktree-delete-execution', () => ({
  runWorktreeDeletesInParallel: mocks.deleteInParallel
}))

import { runWorktreeBatchDelete, runWorktreeDelete } from './delete-worktree-flow'

const HOST = 'runtime:env-a'
const worktree = makeWorktree({
  id: 'repo::/workspace/repo-task',
  repoId: 'repo',
  path: '/workspace/repo-task',
  hostId: HOST,
  displayName: 'task'
})
const removalPreflight = vi.fn<(args: unknown) => Promise<RecipeRemovalCheckResult | null>>()
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api

function preflight(status: RecipeRemovalCheckResult['status']): RecipeRemovalCheckResult {
  return {
    status,
    recordingsNotCopied: [],
    dirtyFiles: status === 'unsafe' ? 1 : 0,
    unpushedCommits: 0,
    ack: 'ack-1'
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

describe("recipe check when deletes skip confirmation (Don't ask again)", () => {
  beforeEach(() => {
    originalApi = window.api
    window.api = { ...window.api, ephemeralVm: { ...window.api?.ephemeralVm, removalPreflight } }
    removalPreflight.mockReset()
    mocks.deleteWithToast.mockClear()
    mocks.deleteInParallel.mockClear()
    useAppStore.setState({
      settings: {
        ...getDefaultSettings('/tmp/orca-test'),
        experimentalEphemeralVms: true,
        skipDeleteWorktreeConfirm: true
      },
      worktreesByRepo: { repo: [worktree] },
      ephemeralVmRuntimesByWorkspaceId: {
        [worktree.id]: {
          id: 'vm-a',
          workspaceId: worktree.id,
          status: 'running',
          runtimeEnvironmentId: 'env-a',
          canSuspend: false
        }
      }
    })
  })
  afterEach(() => {
    window.api = originalApi
    useAppStore.setState(initial, true)
  })

  it('a clean recipe workspace is removed without the dialog', async () => {
    removalPreflight.mockResolvedValue(preflight('clean'))
    runWorktreeDelete(worktree.id, { expectedHostId: HOST })
    await settle()
    expect(removalPreflight).toHaveBeenCalledWith({ hostId: HOST, workspaceId: worktree.id })
    expect(mocks.deleteWithToast).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().activeModal).not.toBe('delete-worktree')
  })

  it('unsafe or unchecked work opens the dialog instead of removing', async () => {
    for (const status of ['unsafe', 'unchecked'] as const) {
      useAppStore.setState({ activeModal: 'none' })
      removalPreflight.mockResolvedValue(preflight(status))
      runWorktreeDelete(worktree.id, { expectedHostId: HOST })
      await settle()
      expect(useAppStore.getState().activeModal).toBe('delete-worktree')
    }
    expect(mocks.deleteWithToast).not.toHaveBeenCalled()

    useAppStore.setState({ activeModal: 'none' })
    expect(runWorktreeBatchDelete([{ id: worktree.id, hostId: HOST }])).toBe(true)
    await settle()
    expect(useAppStore.getState().activeModal).toBe('delete-worktree')
    expect(mocks.deleteInParallel).not.toHaveBeenCalled()
  })
})

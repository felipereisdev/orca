// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import type { RecipeRemovalPreflight } from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import RemoveFolderDialog from './RemoveFolderDialog'

const HOST = 'runtime:env-a'
const root = makeWorktree({
  id: 'repo::/workspace/repo',
  repoId: 'repo',
  path: '/workspace/repo',
  hostId: HOST,
  isMainWorktree: true,
  displayName: 'repo',
  ephemeralVmCheckoutMode: 'provisioned-root'
})
const removalPreflight = vi.fn<(args: unknown) => Promise<RecipeRemovalPreflight | null>>()
const removeProject = vi.fn(async () => {})
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api

describe('removing a provisioned-root project checks its recipe VM first', () => {
  beforeEach(() => {
    originalApi = window.api
    window.api = { ...window.api, ephemeralVm: { ...window.api?.ephemeralVm, removalPreflight } }
    removalPreflight.mockReset()
    removeProject.mockClear()
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms: true },
      repos: [
        { id: 'repo', path: '/workspace/repo', displayName: 'repo', badgeColor: '', addedAt: 1 }
      ],
      worktreesByRepo: { repo: [root] },
      activeModal: 'confirm-remove-folder',
      modalData: { repoId: 'repo', displayName: 'repo', hostId: HOST },
      removeProject
    })
  })
  afterEach(() => {
    cleanup()
    window.api = originalApi
    useAppStore.setState(initial, true)
  })

  it('unsafe work replaces the remove button until the user removes anyway', async () => {
    removalPreflight.mockResolvedValue({
      status: 'unsafe',
      recordingsNotCopied: [],
      dirtyFiles: 0,
      unpushedCommits: 4
    })
    render(<RemoveFolderDialog />)
    await act(async () => {})
    expect(removalPreflight).toHaveBeenCalledWith({ hostId: HOST, workspaceId: root.id })
    expect(screen.getByText('4 commits not pushed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(removeProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    expect(removeProject).toHaveBeenCalledWith('repo', expect.objectContaining({ hostId: HOST }))
  })

  it('a clean VM keeps the dialog as today', async () => {
    removalPreflight.mockResolvedValue({
      status: 'clean',
      recordingsNotCopied: [],
      dirtyFiles: 0,
      unpushedCommits: 0
    })
    render(<RemoveFolderDialog />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })
})

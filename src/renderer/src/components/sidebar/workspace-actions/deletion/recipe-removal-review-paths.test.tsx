// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeRpcCallModule from '@/runtime/rpc/calls/runtime-rpc-call'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import {
  recipeRemovalBridge,
  recipeRuntime
} from '@/runtime/ephemeral-vm/recipe-removal-bridge.test-support'

const rpc = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcCallModule>()),
  callRuntimeRpc: rpc
}))

import { RecipeRemovalReviewDialog } from './RecipeRemovalReviewDialog'
import { EphemeralVmRuntimesSection } from '../../../settings/virtual-machines/runtimes/EphemeralVmRuntimesSection'
import { removeSettingsProjectFromAllHosts } from '../../../settings/navigation/settings-project-list'
import { clearSshHostWorkspaces } from '../../host-lifecycle/ssh-host-remove-workspaces'

const TARGET = 'runtime-ssh-vm'
const HOST = `ssh:${TARGET}`
const WORKSPACE = 'repo::/workspace/repo-task'
const runtime = recipeRuntime({
  workspaceId: WORKSPACE,
  sshTargetId: TARGET,
  workspaceName: 'task'
})
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api
let bridge: ReturnType<typeof recipeRemovalBridge>

async function settle(): Promise<void> {
  for (let i = 0; i < 15; i += 1) {
    await act(async () => {})
  }
}

/** The review appears with what would be lost; removing hands the destroy the check's ack. */
async function removeAnywayFromReview(): Promise<void> {
  await settle()
  expect(screen.getByText('5 commits not pushed')).toBeTruthy()
  expect(bridge.ephemeralVm.cleanup).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
  await settle()
  expect(bridge.ephemeralVm.cleanup).toHaveBeenCalledWith({ runtimeId: 'vm-a', ack: 'ack-unsafe' })
}

describe('removals outside the delete dialog review recipe work first', () => {
  beforeEach(() => {
    originalApi = window.api
    bridge = recipeRemovalBridge([runtime])
    window.api = bridge.api
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms: true },
      repos: [
        {
          id: 'repo',
          path: '/workspace/repo',
          displayName: 'repo',
          badgeColor: '',
          addedAt: 1,
          connectionId: TARGET
        }
      ],
      worktreesByRepo: {
        repo: [makeWorktree({ id: WORKSPACE, repoId: 'repo', hostId: HOST, displayName: 'task' })]
      }
    })
    render(<RecipeRemovalReviewDialog />)
  })
  afterEach(() => {
    cleanup()
    window.api = originalApi
    useAppStore.setState(initial, true)
  })

  it('Cloud VMs cleanup', async () => {
    render(
      <TooltipProvider>
        <EphemeralVmRuntimesSection />
      </TooltipProvider>
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Cleanup' }))
    await removeAnywayFromReview()
  })

  it('Settings project removal', async () => {
    void removeSettingsProjectFromAllHosts(
      [
        {
          id: 'setup',
          projectId: 'project',
          repoId: 'repo',
          hostId: HOST,
          path: '/workspace/repo',
          displayName: 'repo',
          setupState: 'ready',
          setupMethod: 'legacy-repo',
          createdAt: 1,
          updatedAt: 1
        }
      ],
      useAppStore.getState().removeProject
    )
    await removeAnywayFromReview()
  })

  it('SSH host "Also remove workspaces"', async () => {
    void clearSshHostWorkspaces({
      targetId: TARGET,
      workspaceWorktreeIds: [WORKSPACE],
      hostRepoIds: [],
      workspaceCount: 1
    })
    await removeAnywayFromReview()
  })
})

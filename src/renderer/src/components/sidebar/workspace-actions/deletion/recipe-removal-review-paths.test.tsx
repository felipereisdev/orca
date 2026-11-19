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

/** The review appears with what would be lost; nothing is destroyed until the user removes. */
async function removeAnywayFromReview(): Promise<void> {
  await settle()
  expect(screen.getByText('5 commits not pushed')).toBeTruthy()
  expect(bridge.ephemeralVm.cleanup).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
  await settle()
  expect(bridge.ephemeralVm.confirmRemoval).toHaveBeenCalledWith({ ack: 'ack-unsafe' })
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
    expect(bridge.ephemeralVm.cleanup).toHaveBeenCalledWith({
      runtimeId: 'vm-a',
      ack: 'ack-unsafe'
    })
  })

  it('a Cloud VMs review copies the recordings by runtime id, then destroys', async () => {
    const recording = { id: 'aaaaaaaaaaaaaaaa', path: '/rec/a.mp4', bytes: 10 }
    bridge.ephemeralVm.removalPreflight.mockResolvedValue({
      status: 'unsafe',
      recordingsNotCopied: [recording],
      dirtyFiles: 0,
      unpushedCommits: 0,
      ack: 'ack-unsafe'
    })
    bridge.ephemeralVm.copyRecordingsBeforeRemoval.mockResolvedValue({
      ok: true,
      copied: 1,
      ack: 'ack-copy'
    })
    render(
      <TooltipProvider>
        <EphemeralVmRuntimesSection />
      </TooltipProvider>
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Cleanup' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
    await settle()
    expect(bridge.ephemeralVm.copyRecordingsBeforeRemoval).toHaveBeenCalledWith({
      runtimeId: 'vm-a'
    })
    expect(bridge.ephemeralVm.cleanup).toHaveBeenCalledWith({ runtimeId: 'vm-a', ack: 'ack-copy' })
  })

  it('cancelling the Cloud VMs review revokes its ack, and a retry reviews again', async () => {
    render(
      <TooltipProvider>
        <EphemeralVmRuntimesSection />
      </TooltipProvider>
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Cleanup' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await settle()
    expect(bridge.ephemeralVm.revokeRemoval).toHaveBeenCalledWith({ ack: 'ack-unsafe' })
    expect(bridge.ephemeralVm.cleanup).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cleanup' }))
    await settle()
    expect(bridge.ephemeralVm.removalPreflight).toHaveBeenCalledTimes(2)
    expect(screen.getByText('5 commits not pushed')).toBeTruthy()
    expect(bridge.ephemeralVm.cleanup).not.toHaveBeenCalled()
  })

  it('an older provisioned root with no recorded workspace is reviewed in Cloud VMs', async () => {
    const legacy = recipeRuntime({ id: 'vm-root', sshTargetId: TARGET })
    bridge = recipeRemovalBridge([legacy])
    bridge.ephemeralVm.removalPreflight.mockResolvedValue({
      status: 'unchecked',
      recordingsNotCopied: [],
      dirtyFiles: 0,
      unpushedCommits: 0,
      reason: 'workspace_unrecorded',
      ack: 'ack-root'
    })
    window.api = bridge.api
    render(
      <TooltipProvider>
        <EphemeralVmRuntimesSection />
      </TooltipProvider>
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Cleanup' }))
    await settle()
    expect(bridge.ephemeralVm.removalPreflight).toHaveBeenCalledWith({ runtimeId: 'vm-root' })
    expect(screen.getByText("Couldn't verify this workspace")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    await settle()
    expect(bridge.ephemeralVm.cleanup).toHaveBeenCalledWith({
      runtimeId: 'vm-root',
      ack: 'ack-root'
    })
  })

  it('removing a project by its SSH target reviews the VM even with no workspaces listed', async () => {
    useAppStore.setState({ worktreesByRepo: {} })
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
    // Main picks the records by the target; the renderer only names it.
    expect(bridge.ephemeralVm.listRuntimes).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeOwnedSshTargetIds: [TARGET] })
    )
    expect(bridge.ephemeralVm.cleanup).toHaveBeenCalledWith({
      runtimeId: 'vm-a',
      ack: 'ack-unsafe'
    })
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
    // Main lists the VM's records itself; each is checked by its own id.
    expect(bridge.ephemeralVm.removalPreflight).toHaveBeenCalledWith({ runtimeId: 'vm-a' })
    expect(bridge.ephemeralVm.cleanup).toHaveBeenCalledWith({
      runtimeId: 'vm-a',
      ack: 'ack-unsafe'
    })
  })

  it('SSH host "Also remove workspaces"', async () => {
    void clearSshHostWorkspaces({
      targetId: TARGET,
      workspaceWorktreeIds: [WORKSPACE],
      hostRepoIds: [],
      workspaceCount: 1
    })
    await removeAnywayFromReview()
    // The decision is held for these removals before any checkout goes.
    expect(bridge.ephemeralVm.claimRemoval).toHaveBeenCalledWith({
      hostId: HOST,
      workspaceId: WORKSPACE,
      ack: 'ack-unsafe'
    })
  })
})

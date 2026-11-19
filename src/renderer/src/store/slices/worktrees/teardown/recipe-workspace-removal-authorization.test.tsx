// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeRpcCallModule from '@/runtime/rpc/calls/runtime-rpc-call'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import { recipeRemovalBridge } from '@/runtime/ephemeral-vm/recipe-removal-bridge.test-support'

const removed = vi.hoisted(() => {
  const checkouts: string[] = []
  return { checkouts }
})
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcCallModule>()),
  callRuntimeRpc: vi.fn(async (_target: unknown, method: string) => {
    if (method === 'worktree.rm') {
      removed.checkouts.push(method)
      return { removed: true }
    }
    return {}
  })
}))

import { RecipeRemovalReviewDialog } from '@/components/sidebar/workspace-actions/deletion/RecipeRemovalReviewDialog'

const HOST = 'runtime:env-a'
const WORKSPACE = 'repo::/workspace/repo-task'
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api
let bridge: ReturnType<typeof recipeRemovalBridge>

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {})
  }
}

function seed(instanceId: string): void {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms: true },
    worktreesByRepo: {
      repo: [
        makeWorktree({
          id: WORKSPACE,
          repoId: 'repo',
          hostId: HOST,
          displayName: 'task',
          instanceId
        })
      ]
    }
  })
}

describe('a workspace removal holds its recipe environment before deleting the checkout', () => {
  beforeEach(() => {
    removed.checkouts.length = 0
    originalApi = window.api
    bridge = recipeRemovalBridge([])
    window.api = bridge.api
    seed('instance-1')
    render(<RecipeRemovalReviewDialog />)
  })
  afterEach(() => {
    cleanup()
    window.api = originalApi
    useAppStore.setState(initial, true)
  })

  it('a decision already held for this workspace lets the checkout go', async () => {
    const result = await useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    expect(result.ok).toBe(true)
    expect(bridge.ephemeralVm.claimRemoval).toHaveBeenCalledWith({
      hostId: HOST,
      workspaceId: WORKSPACE,
      ack: ''
    })
    expect(removed.checkouts).toEqual(['worktree.rm'])
  })

  it('an expired ack never deletes the checkout', async () => {
    // Nothing held, and the ack the review hands on has expired by the time it is claimed.
    bridge.ephemeralVm.claimRemoval.mockResolvedValue({ ok: false, reason: 'unconfirmed' })
    const removal = useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    await settle()
    expect(screen.getByText('5 commits not pushed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    await settle()
    await expect(removal).resolves.toMatchObject({ ok: false })
    expect(removed.checkouts).toEqual([])
    expect(bridge.ephemeralVm.cleanup).not.toHaveBeenCalled()
  })

  it('a same-id replacement is not deleted', async () => {
    seed('instance-2')
    const result = await useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    expect(result.ok).toBe(false)
    expect(removed.checkouts).toEqual([])
    expect(bridge.ephemeralVm.claimRemoval).not.toHaveBeenCalled()
  })
})

// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeRpcCallModule from '@/runtime/rpc/calls/runtime-rpc-call'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import { recipeRemovalBridge } from '@/runtime/ephemeral-vm/recipe-removal-bridge.test-support'
import { handOffRecipeRemovalSession } from '@/runtime/ephemeral-vm/recipe-removal-session-handoff'
import { runWorktreeDeletesInParallel } from '@/components/sidebar/workspace-actions/deletion/worktree-delete-execution'

const removed = vi.hoisted(() => {
  const checkouts: string[] = []
  return {
    checkouts,
    fail: false,
    /** Send `worktree.rm` through the real call, whose compatibility probe the test holds. */
    throughProbe: false,
    probe: Promise.resolve<unknown>(null)
  }
})
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeRpcCallModule>()
  return {
    ...actual,
    callRuntimeRpc: vi.fn(async (...args: Parameters<typeof actual.callRuntimeRpc>) => {
      if (args[1] !== 'worktree.rm') {
        return {}
      }
      if (removed.fail) {
        throw new Error('Hook failed')
      }
      if (removed.throughProbe) {
        return actual.callRuntimeRpc(...args)
      }
      removed.checkouts.push('worktree.rm')
      return { removed: true }
    })
  }
})
vi.mock('@/runtime/rpc/compatibility/runtime-compatibility-probe', () => ({
  ensureRuntimeEnvironmentCompatible: () => removed.probe
}))
vi.mock('@/runtime/rpc/calls/runtime-rpc-environment-call', () => ({
  callRuntimeEnvironmentWithRevision: async (args: { method: string }) => {
    removed.checkouts.push(args.method)
    return { id: 'req', ok: true, result: { removed: true }, _meta: { runtimeId: 'env-a' } }
  }
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
    removed.fail = false
    removed.throughProbe = false
    removed.probe = Promise.resolve(null)
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
    expect(bridge.ephemeralVm.adoptRemoval).toHaveBeenCalledWith({
      hostId: HOST,
      workspaceId: WORKSPACE
    })
    expect(removed.checkouts).toEqual(['worktree.rm'])
  })

  it('a refused claim checks again and reviews before anything is deleted', async () => {
    // Nothing held, and the ack the first review hands on has expired by the time it is claimed.
    bridge.ephemeralVm.adoptRemoval.mockResolvedValueOnce({ ok: false, reason: 'unconfirmed' })
    bridge.ephemeralVm.claimRemoval.mockResolvedValueOnce({ ok: false, reason: 'unconfirmed' })
    const removal = useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    await settle()
    expect(removed.checkouts).toEqual([])
    expect(bridge.ephemeralVm.removalPreflight).toHaveBeenCalledTimes(2)
    expect(screen.getByText('5 commits not pushed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    await settle()
    await expect(removal).resolves.toMatchObject({ ok: true })
    expect(removed.checkouts).toEqual(['worktree.rm'])
  })

  it('a claim that keeps being refused never deletes the checkout', async () => {
    bridge.ephemeralVm.adoptRemoval.mockResolvedValue({ ok: false, reason: 'unconfirmed' })
    bridge.ephemeralVm.claimRemoval.mockResolvedValue({ ok: false, reason: 'unconfirmed' })
    const removal = useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    for (let review = 0; review < 2; review += 1) {
      await settle()
      fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    }
    await settle()
    await expect(removal).resolves.toMatchObject({ ok: false })
    expect(removed.checkouts).toEqual([])
    expect(bridge.ephemeralVm.cleanup).not.toHaveBeenCalled()
  })

  it('a removal that fails after its claim releases it', async () => {
    removed.fail = true
    const result = await useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    expect(result.ok).toBe(false)
    expect(bridge.ephemeralVm.releaseRemoval).toHaveBeenCalledWith({
      hostId: HOST,
      workspaceId: WORKSPACE
    })
  })

  it('a same-id replacement published while the claim is in flight is not deleted', async () => {
    let replyToClaim: () => void = () => {}
    bridge.ephemeralVm.adoptRemoval.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        replyToClaim = resolve
      })
      return { ok: true, required: true }
    })
    const removal = useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    await settle()
    expect(bridge.ephemeralVm.adoptRemoval).toHaveBeenCalledTimes(1)
    seed('instance-2')
    replyToClaim()
    await expect(removal).resolves.toMatchObject({ ok: false })
    expect(removed.checkouts).toEqual([])
    expect(bridge.ephemeralVm.releaseRemoval).toHaveBeenCalledWith({
      hostId: HOST,
      workspaceId: WORKSPACE
    })
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

  it('a same-id replacement published while the compatibility probe runs is not deleted', async () => {
    removed.throughProbe = true
    let answerProbe: () => void = () => {}
    removed.probe = new Promise((resolve) => {
      answerProbe = () => resolve(null)
    })
    const removal = useAppStore
      .getState()
      .removeWorktree({ id: WORKSPACE, executionHostId: HOST, instanceId: 'instance-1' }, false)
    await settle()
    expect(bridge.ephemeralVm.adoptRemoval).toHaveBeenCalled()
    seed('instance-2')
    answerProbe()
    await expect(removal).resolves.toMatchObject({ ok: false })
    expect(removed.checkouts).toEqual([])
    expect(bridge.ephemeralVm.releaseRemoval).toHaveBeenCalledWith({
      hostId: HOST,
      workspaceId: WORKSPACE
    })
  })

  it('a dialog removal adopts its claim in the session it took over, then ends the session', async () => {
    let deletes: Promise<unknown> = Promise.resolve()
    const taken = handOffRecipeRemovalSession('session-1', () => {
      deletes = runWorktreeDeletesInParallel([
        makeWorktree({
          id: WORKSPACE,
          repoId: 'repo',
          hostId: HOST,
          displayName: 'task',
          instanceId: 'instance-1'
        })
      ])
    })
    expect(taken).toBe(true)
    await deletes
    expect(bridge.ephemeralVm.adoptRemoval).toHaveBeenCalledWith({
      hostId: HOST,
      workspaceId: WORKSPACE,
      sessionId: 'session-1'
    })
    expect(removed.checkouts).toEqual(['worktree.rm'])
    expect(bridge.ephemeralVm.revokeRemovalSession).toHaveBeenCalledWith({ sessionId: 'session-1' })
  })
})

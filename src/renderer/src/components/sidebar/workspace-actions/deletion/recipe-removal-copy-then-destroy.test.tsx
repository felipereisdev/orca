// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeRpcCallModule from '@/runtime/rpc/calls/runtime-rpc-call'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import type { RecipeRemovalCopyResult } from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

const mocks = vi.hoisted(() => {
  const order: string[] = []
  return { order, rpc: vi.fn() }
})
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcCallModule>()),
  callRuntimeRpc: mocks.rpc
}))

import { RecipeRemovalPreflightGate } from './RecipeRemovalPreflightGate'
import { runWorktreeDeletesInParallel } from './worktree-delete-execution'

const HOST = 'runtime:env-a'
const WORKSPACE = 'repo::/workspace/repo-task'
const REC = { id: 'aaaaaaaaaaaaaaaa', path: '/rec/rec-aaaaaaaaaaaaaaaa.mp4', bytes: 10 }
const worktree = makeWorktree({
  id: WORKSPACE,
  repoId: 'repo',
  path: '/workspace/repo-task',
  hostId: HOST,
  displayName: 'task'
})
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api
let copyResult: RecipeRemovalCopyResult = { ok: true, copied: 1, ack: 'ack-copy' }

/** Every bridge call resolves; the ones this removal depends on answer for real. */
function bridge(): typeof window.api {
  const ephemeralVm = {
    removalPreflight: vi.fn(async () => ({
      status: 'unsafe' as const,
      recordingsNotCopied: [REC],
      dirtyFiles: 0,
      unpushedCommits: 0,
      ack: 'ack-check'
    })),
    copyRecordingsBeforeRemoval: vi.fn(async () => {
      mocks.order.push('copy')
      return copyResult
    }),
    listRuntimes: vi.fn(async () => [
      {
        id: 'vm-a',
        recipeId: 'cloud',
        repoId: 'repo',
        workspaceId: WORKSPACE,
        runtimeEnvironmentId: 'env-a',
        status: 'running',
        cleanupStatus: 'not_started',
        createdAt: 1,
        updatedAt: 1
      }
    ]),
    confirmRemoval: vi.fn(async () => true),
    revokeRemoval: vi.fn(async () => {}),
    claimRemoval: vi.fn(async (args: { ack: string }) => {
      mocks.order.push(`claim:${args.ack}`)
      return { ok: true, required: true }
    }),
    // The removal adopts the claim in the dialog session it took over.
    adoptRemoval: vi.fn(async (args: { sessionId?: string }) => {
      mocks.order.push(args.sessionId ? 'adopt:session' : 'adopt:none')
      return { ok: true, required: true }
    }),
    revokeRemovalSession: vi.fn(async () => {}),
    cleanup: vi.fn(async (args: { ack: string }) => {
      mocks.order.push(`destroy:${args.ack}`)
      return {}
    })
  }
  const anyCall = (): unknown => vi.fn(async () => undefined)
  const known: Record<string, unknown> = { ephemeralVm }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the removal only reaches ephemeralVm and fire-and-forget bridge calls, which the proxy answers with resolved promises.
  return new Proxy(known, {
    get: (target, namespace: string) =>
      target[namespace] ??
      new Proxy({}, { get: (_ns, method: string) => (method === 'then' ? undefined : anyCall()) })
  }) as unknown as typeof window.api
}

async function copyAndRemove(): Promise<void> {
  render(
    <Dialog open>
      <DialogContent>
        <RecipeRemovalPreflightGate
          targets={[worktree]}
          onRemove={() => void runWorktreeDeletesInParallel([worktree], { force: true })}
        >
          <button type="button">Current footer</button>
        </RecipeRemovalPreflightGate>
      </DialogContent>
    </Dialog>
  )
  await act(async () => {})
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
  })
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {})
  }
}

describe('copy recordings and remove, through the real removal', () => {
  beforeEach(() => {
    originalApi = window.api
    window.api = bridge()
    mocks.order.length = 0
    mocks.rpc.mockReset().mockImplementation(async (_target, method: string) => {
      if (method === 'worktree.rm') {
        mocks.order.push('worktree.rm')
        return { removed: true }
      }
      return {}
    })
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms: true },
      worktreesByRepo: { repo: [worktree] },
      ephemeralVmRuntimesByWorkspaceId: {
        [WORKSPACE]: {
          id: 'vm-a',
          workspaceId: WORKSPACE,
          status: 'running',
          runtimeEnvironmentId: 'env-a',
          canSuspend: false
        }
      }
    })
  })
  afterEach(() => {
    cleanup()
    window.api = originalApi
    useAppStore.setState(initial, true)
  })

  it('copies the recordings before the environment is destroyed', async () => {
    copyResult = { ok: true, copied: 1, ack: 'ack-copy' }
    await copyAndRemove()
    // The copy's ack is claimed for this removal before the checkout goes; the destroy spends it.
    expect(mocks.order).toEqual([
      'copy',
      'claim:ack-copy',
      'adopt:session',
      'worktree.rm',
      'destroy:'
    ])
  })

  it('a failed copy never destroys the environment', async () => {
    copyResult = { ok: false, reason: 'copy_failed' }
    await copyAndRemove()
    expect(mocks.order).toEqual(['copy'])
  })
})

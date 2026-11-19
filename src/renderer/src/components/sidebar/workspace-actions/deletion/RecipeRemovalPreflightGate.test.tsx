// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import type {
  RecipeRemovalCheckResult,
  RecipeRemovalClaimResult,
  RecipeRemovalCopyResult
} from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import {
  adoptRecipeRemovalClaim,
  claimRecipeRemovalAck,
  confirmRecipeRemovalAck,
  consumeRecipeRemovalAck,
  issueRecipeRemovalAck,
  revokeRecipeRemovalSession
} from '../../../../../../main/ephemeral-vm/recipe-removal-acks'
import { takeRecipeRemovalSession } from '@/runtime/ephemeral-vm/recipe-removal-session-handoff'
import { RecipeRemovalPreflightGate } from './RecipeRemovalPreflightGate'

const WORKSPACE = 'repo::/workspace/repo-task'
const OTHER = 'repo::/workspace/repo-other'
const REC = { id: 'aaaaaaaaaaaaaaaa', path: '/rec/rec-aaaaaaaaaaaaaaaa.mp4', bytes: 10 }
const TASK = { id: WORKSPACE, hostId: 'runtime:env-a', displayName: 'task' }
const OTHER_TASK = {
  id: OTHER,
  hostId: 'runtime:env-a',
  displayName: 'other'
}

type Workspace = { id: string; hostId: string; displayName: string }

const api = {
  confirmRemoval: vi.fn(async (_args: { ack: string }) => true),
  revokeRemoval: vi.fn(async (_args: { ack: string }) => {}),
  revokeRemovalSession: vi.fn(async (_args: { sessionId: string }) => {}),
  claimRemoval: vi.fn(async (_args: { ack: string }): Promise<RecipeRemovalClaimResult> => ({
    ok: true,
    required: true
  })),
  removalPreflight:
    vi.fn<(args: { sessionId?: string }) => Promise<RecipeRemovalCheckResult | null>>(),
  copyRecordingsBeforeRemoval:
    vi.fn<(args: { sessionId?: string }) => Promise<RecipeRemovalCopyResult>>()
}
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api

function runtimeFor(workspaceId: string) {
  return {
    id: 'vm-a',
    workspaceId,
    status: 'running' as const,
    runtimeEnvironmentId: 'env-a',
    canSuspend: false,
    hasDesktop: true
  }
}

function seed(options: { experiment?: boolean; recipe?: boolean } = {}): void {
  useAppStore.setState({
    settings: {
      ...getDefaultSettings('/tmp/orca-test'),
      experimentalEphemeralVms: options.experiment ?? true
    },
    ephemeralVmRuntimesByWorkspaceId:
      options.recipe === false
        ? {}
        : { [WORKSPACE]: runtimeFor(WORKSPACE), [OTHER]: runtimeFor(OTHER) }
  })
}

function preflight(overrides: Partial<RecipeRemovalCheckResult>): RecipeRemovalCheckResult {
  return {
    ack: 'ack-1',
    status: 'clean',
    recordingsNotCopied: [],
    dirtyFiles: 0,
    unpushedCommits: 0,
    ...overrides
  }
}

function Harness(props: {
  targets: readonly Workspace[] | null
  onRemove: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  return (
    <Dialog open>
      <DialogContent>
        <RecipeRemovalPreflightGate {...props}>
          <button type="button">Current footer</button>
        </RecipeRemovalPreflightGate>
      </DialogContent>
    </Dialog>
  )
}

async function renderGate(targets: readonly Workspace[] = [TASK], onRemove = vi.fn()) {
  const view = render(<Harness targets={targets} onRemove={onRemove} />)
  await act(async () => {})
  return { onRemove, view }
}

describe('RecipeRemovalPreflightGate', () => {
  beforeEach(() => {
    originalApi = window.api
    window.api = { ...window.api, ephemeralVm: { ...window.api?.ephemeralVm, ...api } }
    api.removalPreflight.mockReset()
    api.copyRecordingsBeforeRemoval.mockReset()
    api.confirmRemoval.mockClear()
    api.revokeRemoval.mockClear()
    api.claimRemoval.mockClear()
    seed()
  })
  afterEach(() => {
    cleanup()
    window.api = originalApi
    useAppStore.setState(initial, true)
  })

  it('keeps the dialog unchanged for a clean recipe workspace and for other workspaces', async () => {
    api.removalPreflight.mockResolvedValue(preflight({}))
    await renderGate()
    expect(screen.getByText('Current footer')).toBeTruthy()
    expect(api.removalPreflight).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'runtime:env-a', workspaceId: WORKSPACE })
    )
    cleanup()

    api.removalPreflight.mockClear()
    await renderGate([{ ...TASK, hostId: 'local' }])
    expect(screen.getByText('Current footer')).toBeTruthy()
    expect(api.removalPreflight).not.toHaveBeenCalled()
  })

  it('holds the removal while the check runs', async () => {
    api.removalPreflight.mockReturnValue(new Promise(() => {}))
    await renderGate()
    expect(screen.queryByText('Current footer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Checking…' }).hasAttribute('disabled')).toBe(true)
  })

  it('unsafe shows the counts and removes only after every recording was copied', async () => {
    api.removalPreflight.mockResolvedValue(
      preflight({
        status: 'unsafe',
        recordingsNotCopied: [REC],
        dirtyFiles: 2,
        dirtyFilesCapped: true,
        unpushedCommits: 1
      })
    )
    api.copyRecordingsBeforeRemoval.mockResolvedValueOnce({ ok: false, reason: 'copy_failed' })
    const { onRemove } = await renderGate()
    expect(screen.getByText('1 recording not copied to this Mac')).toBeTruthy()
    expect(screen.getByText('2+ files with uncommitted changes')).toBeTruthy()
    expect(screen.getByText('1 commit not pushed')).toBeTruthy()
    expect(screen.queryByText('Current footer')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
    })
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain("A recording couldn't be copied")

    api.copyRecordingsBeforeRemoval.mockResolvedValueOnce({ ok: true, copied: 1, ack: 'ack-copy' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
    })
    expect(api.copyRecordingsBeforeRemoval).toHaveBeenLastCalledWith(
      expect.objectContaining({ hostId: 'runtime:env-a', workspaceId: WORKSPACE })
    )
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('recordings still pending after the copy show the new counts instead of removing', async () => {
    api.removalPreflight.mockResolvedValue(
      preflight({ status: 'unsafe', recordingsNotCopied: [REC] })
    )
    api.copyRecordingsBeforeRemoval.mockResolvedValue({
      ok: false,
      reason: 'still_pending',
      preflight: preflight({
        status: 'unsafe',
        recordingsNotCopied: [REC, { ...REC, id: 'bbbbbbbbbbbbbbbb' }]
      })
    })
    const { onRemove } = await renderGate()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
    })
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('2 recordings not copied to this Mac')).toBeTruthy()
  })

  it('dismissing the dialog during the copy never removes', async () => {
    api.removalPreflight.mockResolvedValue(
      preflight({ status: 'unsafe', recordingsNotCopied: [REC] })
    )
    let finishCopy: (result: RecipeRemovalCopyResult) => void = () => {}
    api.copyRecordingsBeforeRemoval.mockReturnValue(
      new Promise((resolve) => {
        finishCopy = resolve
      })
    )
    const onRemove = vi.fn()
    const onBusyChange = vi.fn()
    const view = render(
      <Harness targets={[TASK]} onRemove={onRemove} onBusyChange={onBusyChange} />
    )
    await act(async () => {})
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
    })
    // The dialog is busy while copying, so it can't be dismissed by Escape or an outside click.
    expect(onBusyChange).toHaveBeenLastCalledWith(true)

    view.rerender(<Harness targets={null} onRemove={onRemove} onBusyChange={onBusyChange} />)
    await act(async () => {
      finishCopy({ ok: true, copied: 1, ack: 'ack-copy' })
    })
    expect(onRemove).not.toHaveBeenCalled()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('unchecked says it could not verify and never shows the clean dialog', async () => {
    api.removalPreflight.mockResolvedValue(preflight({ status: 'unchecked', reason: 'timeout' }))
    const { onRemove } = await renderGate()
    expect(screen.getByText("Couldn't verify this workspace")).toBeTruthy()
    expect(screen.getByText("The environment didn't answer in time.")).toBeTruthy()
    expect(screen.queryByText('Current footer')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy recordings and remove' })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    })
    // "Remove anyway" makes the undecided answers usable, then holds them for this removal.
    expect(api.confirmRemoval).toHaveBeenCalled()
    expect(api.claimRemoval).toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('a failed bridge call is unchecked, not clean', async () => {
    api.removalPreflight.mockRejectedValue(new Error('No handler registered'))
    await renderGate()
    expect(screen.getByText("Couldn't verify this workspace")).toBeTruthy()
    expect(screen.queryByText('Current footer')).toBeNull()
  })

  it('a batch lists each workspace that is not clean, with only remove anyway and cancel', async () => {
    api.removalPreflight.mockImplementation(async (args) =>
      JSON.stringify(args).includes('repo-task')
        ? preflight({ status: 'unsafe', recordingsNotCopied: [REC], unpushedCommits: 3 })
        : preflight({ status: 'unchecked', reason: 'unreachable' })
    )
    const { onRemove } = await renderGate([TASK, OTHER_TASK])
    expect(screen.getByText('task')).toBeTruthy()
    expect(screen.getByText('3 commits not pushed')).toBeTruthy()
    expect(screen.getByText("other — Couldn't verify this workspace")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy recordings and remove' })).toBeNull()
    expect(screen.queryByText('Current footer')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    })
    // "Remove anyway" makes the undecided answers usable, then holds them for this removal.
    expect(api.confirmRemoval).toHaveBeenCalled()
    expect(api.claimRemoval).toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('a claim that rejects leaves close and retry enabled', async () => {
    api.removalPreflight.mockResolvedValue(preflight({ status: 'unchecked', reason: 'timeout' }))
    api.claimRemoval.mockRejectedValueOnce(new Error('No handler registered'))
    const onBusyChange = vi.fn()
    const onRemove = vi.fn()
    render(<Harness targets={[TASK]} onRemove={onRemove} onBusyChange={onBusyChange} />)
    await act(async () => {})
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    })
    await act(async () => {})
    expect(onRemove).not.toHaveBeenCalled()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Remove anyway' }).hasAttribute('disabled')).toBe(
      false
    )
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false)
  })

  describe('with main deciding the acks', () => {
    const binding = {
      hostId: 'runtime:env-a',
      workspaceId: WORKSPACE,
      runtimeId: 'vm-a',
      runtimeCreatedAt: 1
    }
    const record = { id: 'vm-a', createdAt: 1, hostIds: ['runtime:env-a'], workspaceId: WORKSPACE }
    let replyToClaim: () => void = () => {}

    beforeEach(() => {
      api.removalPreflight.mockImplementation(async ({ sessionId }) =>
        preflight({
          status: 'unsafe',
          recordingsNotCopied: [REC],
          unpushedCommits: 1,
          ack: issueRecipeRemovalAck(binding, false, sessionId)
        })
      )
      api.copyRecordingsBeforeRemoval.mockImplementation(async ({ sessionId }) => ({
        ok: true,
        copied: 1,
        ack: issueRecipeRemovalAck(binding, true, sessionId)
      }))
      api.confirmRemoval.mockImplementation(async ({ ack }) => confirmRecipeRemovalAck(ack))
      api.revokeRemovalSession.mockImplementation(async ({ sessionId }) =>
        revokeRecipeRemovalSession(sessionId)
      )
      // Main records the claim at once; its reply reaches the renderer only when the test says.
      api.claimRemoval.mockImplementation(async ({ ack }) => {
        const claimed = claimRecipeRemovalAck(ack, binding)
        await new Promise<void>((resolve) => {
          replyToClaim = resolve
        })
        return claimed.ok ? { ok: true, required: true } : claimed
      })
    })
    afterEach(() => {
      api.confirmRemoval.mockReset().mockResolvedValue(true)
      api.revokeRemovalSession.mockReset().mockResolvedValue(undefined)
      api.claimRemoval.mockReset().mockResolvedValue({ ok: true, required: true })
    })

    async function decide(
      button: 'Remove anyway' | 'Copy recordings and remove',
      onRemove: () => void,
      onBusyChange = vi.fn()
    ) {
      const view = render(
        <Harness targets={[TASK]} onRemove={onRemove} onBusyChange={onBusyChange} />
      )
      await act(async () => {})
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: button }))
      })
      expect(api.claimRemoval).toHaveBeenCalled()
      return {
        close: () =>
          view.rerender(<Harness targets={null} onRemove={onRemove} onBusyChange={onBusyChange} />)
      }
    }

    it.each(['Remove anyway', 'Copy recordings and remove'] as const)(
      'closing while the claim of "%s" is in flight never removes, and nothing can use the claim',
      async (button) => {
        const onRemove = vi.fn()
        const onBusyChange = vi.fn()
        const { close } = await decide(button, onRemove, onBusyChange)
        // Still busy while the claim is out, so the dialog can't be dismissed under it.
        expect(onBusyChange).toHaveBeenLastCalledWith(true)
        close()
        await act(async () => {
          replyToClaim()
        })
        expect(onRemove).not.toHaveBeenCalled()
        expect(() => consumeRecipeRemovalAck('', record)).toThrow('not confirmed')
      }
    )

    it('a removal callback that stops before the store takes over leaves the claim to be revoked', async () => {
      // Like a changed target list: the dialog's callback returns without starting a removal.
      const onRemove = vi.fn()
      const { close } = await decide('Remove anyway', onRemove)
      await act(async () => {
        replyToClaim()
      })
      expect(onRemove).toHaveBeenCalledTimes(1)
      close()
      await act(async () => {})
      expect(() => consumeRecipeRemovalAck('', record)).toThrow('not confirmed')
    })

    it('a removal that takes over the session keeps the claim for the store to adopt', async () => {
      let taken: string | undefined
      const { close } = await decide('Remove anyway', () => {
        taken = takeRecipeRemovalSession()
      })
      await act(async () => {
        replyToClaim()
      })
      close()
      await act(async () => {})
      expect(taken).toBeTruthy()
      expect(adoptRecipeRemovalClaim(binding, taken)).toEqual({ ok: true })
      expect(() => consumeRecipeRemovalAck('', record)).not.toThrow()
    })
  })
})

// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import type {
  RecipeRemovalCopyResult,
  RecipeRemovalPreflight
} from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { RecipeRemovalPreflightGate } from './RecipeRemovalPreflightGate'

const WORKSPACE = 'repo::/workspace/repo-task'
const TARGET = {
  runtimeId: 'vm-a',
  workspaceId: WORKSPACE,
  environmentId: 'env-a',
  hasDesktop: true,
  asleep: false
}
const REC = { id: 'aaaaaaaaaaaaaaaa', path: '/rec/rec-aaaaaaaaaaaaaaaa.mp4', bytes: 10 }

const api = {
  removalPreflight: vi.fn<(args: unknown) => Promise<RecipeRemovalPreflight | null>>(),
  copyRecordingsBeforeRemoval: vi.fn<(args: unknown) => Promise<RecipeRemovalCopyResult>>()
}
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api

function seed(options: { experiment?: boolean; recipe?: boolean } = {}): void {
  useAppStore.setState({
    settings: {
      ...getDefaultSettings('/tmp/orca-test'),
      experimentalEphemeralVms: options.experiment ?? true
    },
    ephemeralVmRuntimesByWorkspaceId:
      options.recipe === false
        ? {}
        : {
            [WORKSPACE]: {
              id: 'vm-a',
              workspaceId: WORKSPACE,
              status: 'running',
              runtimeEnvironmentId: 'env-a',
              canSuspend: false,
              hasDesktop: true
            }
          }
  })
}

function preflight(overrides: Partial<RecipeRemovalPreflight>): RecipeRemovalPreflight {
  return {
    status: 'clean',
    recordingsNotCopied: [],
    dirtyFiles: 0,
    unpushedCommits: 0,
    ...overrides
  }
}

async function renderGate(onRemove = vi.fn()) {
  render(
    <Dialog open>
      <DialogContent>
        <RecipeRemovalPreflightGate workspaceId={WORKSPACE} onRemove={onRemove}>
          <button type="button">Current footer</button>
        </RecipeRemovalPreflightGate>
      </DialogContent>
    </Dialog>
  )
  await act(async () => {})
  return onRemove
}

describe('RecipeRemovalPreflightGate', () => {
  beforeEach(() => {
    originalApi = window.api
    window.api = { ...window.api, ephemeralVm: { ...window.api?.ephemeralVm, ...api } }
    api.removalPreflight.mockReset()
    api.copyRecordingsBeforeRemoval.mockReset()
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
    expect(api.removalPreflight).toHaveBeenCalledWith(TARGET)
    cleanup()

    api.removalPreflight.mockClear()
    seed({ recipe: false })
    await renderGate()
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
      preflight({ status: 'unsafe', recordingsNotCopied: [REC], dirtyFiles: 2, unpushedCommits: 1 })
    )
    api.copyRecordingsBeforeRemoval.mockResolvedValueOnce({ ok: false, reason: 'copy_failed' })
    const onRemove = await renderGate()
    expect(screen.getByText('1 recording not copied to this Mac')).toBeTruthy()
    expect(screen.getByText('2 files with uncommitted changes')).toBeTruthy()
    expect(screen.getByText('1 commit not pushed')).toBeTruthy()
    expect(screen.queryByText('Current footer')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
    })
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain("A recording couldn't be copied")
    expect(screen.getByRole('button', { name: 'Remove anyway' }).hasAttribute('disabled')).toBe(
      false
    )

    api.copyRecordingsBeforeRemoval.mockResolvedValueOnce({ ok: true, copied: 1 })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy recordings and remove' }))
    })
    expect(api.copyRecordingsBeforeRemoval).toHaveBeenLastCalledWith({
      ...TARGET
    })
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('unchecked says it could not verify and never shows the clean dialog', async () => {
    api.removalPreflight.mockResolvedValue(preflight({ status: 'unchecked', reason: 'timeout' }))
    const onRemove = await renderGate()
    expect(screen.getByText("Couldn't verify this workspace")).toBeTruthy()
    expect(screen.getByText("The environment didn't answer in time.")).toBeTruthy()
    expect(screen.queryByText('Current footer')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy recordings and remove' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('a failed bridge call is unchecked, not clean', async () => {
    api.removalPreflight.mockRejectedValue(new Error('No handler registered'))
    await renderGate()
    expect(screen.getByText("Couldn't verify this workspace")).toBeTruthy()
    expect(screen.queryByText('Current footer')).toBeNull()
  })
})

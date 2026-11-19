// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/index'
import type { EphemeralVmRuntimeRecord } from '../../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import { recipeRuntime } from '@/runtime/ephemeral-vm/recipe-removal-bridge.test-support'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'
import { EphemeralVmRunningIndicator } from './EphemeralVmRunningIndicator'

const openSettingsPage = vi.fn()
const openSettingsTarget = vi.fn()
const initial = useAppStore.getInitialState()
let originalApi: typeof window.api

const recipeResult = {
  schemaVersion: 1 as const,
  connection: {
    type: 'ssh' as const,
    target: { label: 'env', host: '127.0.0.1', port: 2222, username: 'dev' },
    projectRoot: '/workspace'
  }
}

function provisioned(
  id: string,
  status: EphemeralVmRuntimeRecord['status'],
  workspaceId?: string
): EphemeralVmRuntimeRecord {
  return recipeRuntime({ id, status, recipeResult, ...(workspaceId ? { workspaceId } : {}) })
}

/** Main's full list, read the way the app reads it: through the lifecycle slice's refresh. */
async function renderWith(runtimes: EphemeralVmRuntimeRecord[], experimentalEphemeralVms = true) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the slice only calls ephemeralVm.listRuntimes.
  window.api = {
    ephemeralVm: { listRuntimes: async () => runtimes }
  } as unknown as typeof window.api
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms },
    openSettingsPage,
    openSettingsTarget
  })
  await act(async () => {
    await useAppStore.getState().refreshEphemeralVmRuntimes()
  })
  return render(
    <TooltipProvider>
      <EphemeralVmRunningIndicator iconOnly={false} />
    </TooltipProvider>
  )
}

beforeEach(() => {
  originalApi = window.api
  openSettingsPage.mockReset()
  openSettingsTarget.mockReset()
})
afterEach(() => {
  cleanup()
  window.api = originalApi
  useAppStore.setState(initial, true)
})

describe('EphemeralVmRunningIndicator', () => {
  it('indicator shows the number of running environments and hides at zero', async () => {
    await renderWith([
      provisioned('a', 'running', 'ws-a'),
      provisioned('b', 'suspend_failed', 'ws-b'),
      provisioned('c', 'suspended', 'ws-c'),
      provisioned('d', 'resume_failed', 'ws-d'),
      provisioned('e', 'failed', 'ws-e'),
      recipeRuntime({ id: 'f', status: 'provisioning', workspaceId: 'ws-f' })
    ])
    fireEvent.click(screen.getByRole('button', { name: '2 environments running' }))
    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'experimental',
      repoId: null,
      sectionId: 'ephemeral-vms'
    })
    expect(openSettingsPage).toHaveBeenCalledOnce()
    cleanup()

    await renderWith([provisioned('a', 'running', 'ws-a')])
    expect(screen.getByRole('button', { name: '1 environment running' })).toBeInTheDocument()
    cleanup()

    await renderWith([provisioned('c', 'suspended', 'ws-c')])
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    await renderWith([provisioned('a', 'running', 'ws-a')], false)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('counts unattached runtimes and every runtime of one workspace', async () => {
    await renderWith([
      provisioned('unattached', 'running'),
      provisioned('first', 'running', 'ws-shared'),
      provisioned('second', 'running', 'ws-shared')
    ])
    expect(screen.getByRole('button', { name: '3 environments running' })).toBeInTheDocument()
  })

  it('shows the count beside the icon in compact mode', async () => {
    await renderWith([provisioned('a', 'running', 'ws-a'), provisioned('b', 'running', 'ws-b')])
    cleanup()
    render(
      <TooltipProvider>
        <EphemeralVmRunningIndicator iconOnly />
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: '2 environments running' }).textContent).toBe('2')
  })
})

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/index'
import type { EphemeralVmWorkspaceRuntime } from '@/store/slices/ephemeral-vm/ephemeral-vm-lifecycle'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'
import { EphemeralVmRunningIndicator } from './EphemeralVmRunningIndicator'

const openSettingsPage = vi.fn()
const openSettingsTarget = vi.fn()

function runtimeIn(
  workspaceId: string,
  status: EphemeralVmWorkspaceRuntime['status']
): [string, EphemeralVmWorkspaceRuntime] {
  return [workspaceId, { id: `runtime-${workspaceId}`, workspaceId, status, canSuspend: true }]
}

function renderWith(
  runtimes: [string, EphemeralVmWorkspaceRuntime][],
  experimentalEphemeralVms = true
) {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms },
    ephemeralVmRuntimesByWorkspaceId: Object.fromEntries(runtimes),
    openSettingsPage,
    openSettingsTarget
  })
  return render(
    <TooltipProvider>
      <EphemeralVmRunningIndicator iconOnly={false} />
    </TooltipProvider>
  )
}

beforeEach(() => {
  openSettingsPage.mockReset()
  openSettingsTarget.mockReset()
})
afterEach(cleanup)

describe('EphemeralVmRunningIndicator', () => {
  it('indicator shows the number of running environments and hides at zero', () => {
    renderWith([
      runtimeIn('a', 'running'),
      runtimeIn('b', 'suspend_failed'),
      runtimeIn('c', 'suspended'),
      runtimeIn('d', 'resume_failed'),
      runtimeIn('e', 'provisioning'),
      runtimeIn('f', 'failed')
    ])
    fireEvent.click(screen.getByRole('button', { name: '2 environments running' }))
    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'experimental',
      repoId: null,
      sectionId: 'ephemeral-vms'
    })
    expect(openSettingsPage).toHaveBeenCalledOnce()
    cleanup()

    renderWith([runtimeIn('a', 'running')])
    expect(screen.getByRole('button', { name: '1 environment running' })).toBeInTheDocument()
    cleanup()

    renderWith([runtimeIn('c', 'suspended')])
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    renderWith([runtimeIn('a', 'running')], false)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import {
  recipeRemovalBridge,
  recipeRuntime
} from '@/runtime/ephemeral-vm/recipe-removal-bridge.test-support'
import { EphemeralVmRuntimesSection } from './EphemeralVmRuntimesSection'

const initial = useAppStore.getInitialState()
const recipeResult = {
  schemaVersion: 1 as const,
  connection: {
    type: 'ssh' as const,
    target: { label: 'env', host: '127.0.0.1', port: 2222, username: 'dev' },
    projectRoot: '/workspace'
  }
}
let originalApi: typeof window.api

beforeEach(() => {
  originalApi = window.api
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms: true }
  })
})
afterEach(() => {
  cleanup()
  window.api = originalApi
  useAppStore.setState(initial, true)
})

describe('EphemeralVmRuntimesSection', () => {
  it('settings show stats or a dash', async () => {
    const bridge = recipeRemovalBridge([
      recipeRuntime({ id: 'vm-a', workspaceName: 'alpha', createdAt: 3, recipeResult }),
      recipeRuntime({ id: 'vm-b', workspaceName: 'beta', createdAt: 2, recipeResult }),
      recipeRuntime({
        id: 'vm-c',
        workspaceName: 'gamma',
        createdAt: 1,
        status: 'suspended',
        recipeResult
      })
    ])
    const runtimeStats = vi.fn(async ({ runtimeId }: { runtimeId: string }) =>
      runtimeId === 'vm-a'
        ? { cpuPercent: 12.5, memoryBytes: 1_500_000_000, diskBytes: 340_000_000 }
        : null
    )
    Object.assign(bridge.ephemeralVm, { runtimeStats })
    window.api = bridge.api

    render(
      <TooltipProvider>
        <EphemeralVmRuntimesSection />
      </TooltipProvider>
    )
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {})
    }

    const statsOf = (name: string): HTMLElement | null => {
      const element = screen.getByText(name).closest<HTMLElement>('[data-runtime-row]')
      if (!element) {
        throw new Error(`no row for ${name}`)
      }
      return within(element).queryByTestId('runtime-stats')
    }
    expect(statsOf('alpha')?.textContent).toBe('CPU 12.5% · Memory 1.5 GB · Disk 340 MB')
    expect(statsOf('beta')?.textContent).toBe('CPU — · Memory — · Disk —')
    expect(statsOf('gamma')).toBeNull()
    expect(runtimeStats.mock.calls.map(([args]) => args.runtimeId).sort()).toEqual(['vm-a', 'vm-b'])
  })
})

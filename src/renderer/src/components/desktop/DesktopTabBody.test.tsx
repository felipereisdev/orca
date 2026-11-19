// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'

type DesktopStatus = {
  state: 'unconfigured' | 'connecting' | 'ready' | 'unavailable'
  owner: 'agent' | 'user'
  recording: boolean
}

type Params = { owner?: 'agent' | 'user'; viewerId?: string }

const mocks = vi.hoisted(() => {
  const status: DesktopStatus = { state: 'ready', owner: 'agent', recording: false }
  const viewers: { viewOnly: boolean; channel: unknown }[] = []
  const channelViewerIds: string[] = []
  // Status reads held back by a test, answered later with whatever it chooses.
  const heldReads: ((status: unknown) => void)[] = []
  const heldControl: ((status: unknown) => void)[] = []
  const state: {
    status: DesktopStatus
    controller: string | null
    holdReads: boolean
    holdControl: boolean
    statusError: { code: string; message: string } | null
  } = { status, controller: null, holdReads: false, holdControl: false, statusError: null }
  return Object.assign(state, { rpc: vi.fn(), heldReads, heldControl, viewers, channelViewerIds })
})

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc: mocks.rpc }))
vi.mock('@/lib/files/access/file-owner-runtime-target', () => ({
  getRuntimeTargetForWorktreeOwner: () => ({ kind: 'environment', environmentId: 'env-1' })
}))
vi.mock('./desktop-viewer-channel', () => ({
  createDesktopViewerChannel: (_target: unknown, viewerId: string) => {
    mocks.channelViewerIds.push(viewerId)
    return { viewerId }
  }
}))
vi.mock('@novnc/novnc', () => ({
  default: class {
    viewOnly = false
    scaleViewport = false
    resizeSession = false
    channel: unknown
    constructor(_target: HTMLElement, channel: unknown) {
      this.channel = channel
      mocks.viewers.push(this)
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    disconnect(): void {}
  }
}))

import { DesktopTabBody } from './DesktopTabBody'

function statusFor(viewerId: string | undefined) {
  const viewerControl =
    mocks.status.owner !== 'user' ? null : mocks.controller === viewerId ? 'this' : 'other'
  return { ...mocks.status, viewerControl }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

const calls = (method: string) =>
  mocks.rpc.mock.calls.filter(([, name]) => name === method).map(([, , params]) => params)

function setExperiment(enabled: boolean): void {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms: enabled }
  })
}

const initial = useAppStore.getInitialState()

describe('DesktopTabBody', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setExperiment(true)
    mocks.viewers.length = 0
    mocks.channelViewerIds.length = 0
    mocks.heldReads.length = 0
    mocks.heldControl.length = 0
    mocks.holdReads = false
    mocks.holdControl = false
    mocks.statusError = null
    mocks.controller = null
    mocks.rpc.mockReset().mockImplementation(async (_target, method: string, params: Params) => {
      if (method === 'desktop.status') {
        if (mocks.statusError) {
          throw mocks.statusError
        }
        if (mocks.holdReads) {
          return new Promise((resolve) => mocks.heldReads.push(resolve))
        }
        return statusFor(params.viewerId)
      }
      if (method === 'desktop.control.set' && params.owner) {
        mocks.status = { ...mocks.status, owner: params.owner }
        mocks.controller = params.owner === 'user' ? (params.viewerId ?? null) : null
        if (mocks.holdControl) {
          const acknowledged = mocks.status
          return new Promise((resolve) => mocks.heldControl.push(() => resolve(acknowledged)))
        }
        return mocks.status
      }
      if (method === 'desktop.record.start') {
        mocks.status = { ...mocks.status, recording: true }
        return { id: 'r1', path: '/rec/r1.mp4' }
      }
      throw new Error(`Unexpected ${method}`)
    })
  })
  afterEach(() => {
    cleanup()
    useAppStore.setState(initial, true)
    vi.useRealTimers()
  })

  it('tab body is view-only until Assumir controle, then calls desktop.control.set with owner user', async () => {
    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    expect(mocks.viewers).toHaveLength(1)
    expect(mocks.viewers[0].viewOnly).toBe(true)
    expect(calls('desktop.status')[0]).toEqual({ viewerId: mocks.channelViewerIds[0] })

    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await flush()

    expect(calls('desktop.control.set')).toEqual([
      { owner: 'user', viewerId: mocks.channelViewerIds[0] }
    ])
    expect(mocks.viewers[0].viewOnly).toBe(false)
    expect(screen.getByRole('button', { name: 'Hand back to agent' })).toBeTruthy()
  })

  it('Devolver ao agente sets owner agent', async () => {
    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Hand back to agent' }))
    await flush()

    expect(calls('desktop.control.set').at(-1)).toEqual({
      owner: 'agent',
      viewerId: mocks.channelViewerIds[0]
    })
    expect(mocks.viewers[0].viewOnly).toBe(true)
    expect(screen.getByText('Agent in control')).toBeTruthy()
  })

  it('control held by another window stays view-only and can be taken here', async () => {
    mocks.status = { state: 'ready', owner: 'user', recording: false }
    mocks.controller = 'another-window-viewer'
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    expect(screen.getByText('Control in another window')).toBeTruthy()
    expect(mocks.viewers[0].viewOnly).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await flush()

    expect(calls('desktop.control.set')).toEqual([
      { owner: 'user', viewerId: mocks.channelViewerIds[0] }
    ])
    expect(screen.getByText("You're in control")).toBeTruthy()
    expect(mocks.viewers[0].viewOnly).toBe(false)
  })

  it('unavailable status shows the retry action', async () => {
    mocks.status = { state: 'unavailable', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    expect(mocks.viewers).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull()

    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(mocks.viewers).toHaveLength(1)
  })

  it('an unconfigured desktop offers retry and connects once it is set up', async () => {
    mocks.status = { state: 'unconfigured', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    expect(screen.getByText('Not set up yet')).toBeTruthy()
    expect(mocks.viewers).toHaveLength(0)

    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()

    expect(mocks.viewers).toHaveLength(1)
  })

  it('a status read that started before taking control does not undo it', async () => {
    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    mocks.holdReads = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    const stale = statusFor(mocks.channelViewerIds[0])
    expect(mocks.heldReads).toHaveLength(1)

    mocks.holdReads = false
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await flush()
    mocks.heldReads[0](stale)
    await flush()

    expect(screen.getByText("You're in control")).toBeTruthy()
    expect(mocks.viewers[0].viewOnly).toBe(false)
  })

  it('a status read that starts during taking control and lands after the ack does not undo it', async () => {
    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    const stale = statusFor(mocks.channelViewerIds[0])
    mocks.holdReads = true
    mocks.holdControl = true

    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    const startedDuring = mocks.heldReads.splice(0)
    // The ack and a read begun during the mutation land together; the fresh read stays held.
    act(() => {
      mocks.heldControl[0](undefined)
      for (const resolve of startedDuring) {
        resolve(stale)
      }
    })
    await flush()

    expect(screen.getByText("You're in control")).toBeTruthy()
    expect(mocks.viewers[0].viewOnly).toBe(false)
  })

  it('a failed retry keeps the localized reason', async () => {
    mocks.statusError = { code: 'desktop_agent_not_allowed', message: 'Agents cannot view.' }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    const reason = 'Only the computer that set up this desktop can view or control it.'
    expect(screen.getByRole('alert').textContent).toBe(reason)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()

    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(reason)
  })

  it('a status read that started before recording does not undo it', async () => {
    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    mocks.holdReads = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    const stale = statusFor(mocks.channelViewerIds[0])

    mocks.holdReads = false
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await flush()
    mocks.heldReads[0](stale)
    await flush()

    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeTruthy()
  })

  it('a restored tab with the experiment off shows a notice and calls nothing', async () => {
    setExperiment(false)
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()

    expect(screen.getByText('Desktop disabled (experiment off)')).toBeTruthy()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.viewers).toHaveLength(0)
  })
})

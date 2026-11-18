// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DesktopStatus = {
  state: 'unconfigured' | 'connecting' | 'ready' | 'unavailable'
  owner: 'agent' | 'user'
  recording: boolean
}

const mocks = vi.hoisted(() => {
  const status: DesktopStatus = { state: 'ready', owner: 'agent', recording: false }
  const viewers: { viewOnly: boolean; channel: unknown }[] = []
  const channelViewerIds: string[] = []
  return { rpc: vi.fn(), status, viewers, channelViewerIds }
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

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

const calls = (method: string) =>
  mocks.rpc.mock.calls.filter(([, name]) => name === method).map(([, , params]) => params)

describe('DesktopTabBody', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.viewers.length = 0
    mocks.channelViewerIds.length = 0
    mocks.rpc
      .mockReset()
      .mockImplementation(async (_target, method: string, params: { owner?: 'agent' | 'user' }) => {
        if (method === 'desktop.status') {
          return mocks.status
        }
        if (method === 'desktop.control.set' && params.owner) {
          mocks.status = { ...mocks.status, owner: params.owner }
          return mocks.status
        }
        throw new Error(`Unexpected ${method}`)
      })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('tab body is view-only until Assumir controle, then calls desktop.control.set with owner user', async () => {
    mocks.status = { state: 'ready', owner: 'agent', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    expect(mocks.viewers).toHaveLength(1)
    expect(mocks.viewers[0].viewOnly).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await flush()

    expect(calls('desktop.control.set')).toEqual([
      { owner: 'user', viewerId: mocks.channelViewerIds[0] }
    ])
    expect(mocks.viewers[0].viewOnly).toBe(false)
    expect(screen.getByRole('button', { name: 'Hand back to agent' })).toBeTruthy()
  })

  it('Devolver ao agente sets owner agent', async () => {
    mocks.status = { state: 'ready', owner: 'user', recording: false }
    render(<DesktopTabBody worktreeId="repo::/w" />)
    await flush()
    expect(mocks.viewers[0].viewOnly).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Hand back to agent' }))
    await flush()

    expect(calls('desktop.control.set')).toEqual([
      { owner: 'agent', viewerId: mocks.channelViewerIds[0] }
    ])
    expect(mocks.viewers[0].viewOnly).toBe(true)
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
})

import { describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import { createDesktopViewerChannel, type DesktopViewerSubscribe } from './desktop-viewer-channel'

type Callbacks = Parameters<DesktopViewerSubscribe>[1]

function ok(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'env-runtime' } }
}

function fakeSubscribe() {
  const sent: number[][] = []
  const unsubscribe = vi.fn()
  let callbacks: Callbacks | undefined
  let args: Parameters<DesktopViewerSubscribe>[0] | undefined
  const subscribe: DesktopViewerSubscribe = async (nextArgs, nextCallbacks) => {
    args = nextArgs
    callbacks = nextCallbacks
    return { unsubscribe, sendBinary: (bytes) => sent.push([...bytes]) }
  }
  return {
    subscribe,
    sent,
    unsubscribe,
    args: () => args,
    server: () => callbacks!
  }
}

describe('desktop viewer channel', () => {
  it('viewer channel forwards binary both ways and reports close', async () => {
    const fake = fakeSubscribe()
    const channel = createDesktopViewerChannel(
      { kind: 'environment', environmentId: 'env-1' },
      'viewer-1',
      fake.subscribe
    )
    const opened = vi.fn()
    const received: number[][] = []
    const closed = vi.fn()
    channel.onopen = opened
    channel.onmessage = (event) => received.push([...new Uint8Array(event.data)])
    channel.onclose = closed
    expect(channel.readyState).toBe(0)
    await Promise.resolve()

    expect(fake.args()).toMatchObject({
      selector: 'env-1',
      method: 'desktop.viewer',
      params: { viewerId: 'viewer-1' }
    })
    // The server may speak before the viewer opens; those bytes wait for it.
    fake.server().onBinary?.(new Uint8Array([82, 70, 66]))
    expect(received).toEqual([])
    fake.server().onResponse(ok({ type: 'ready', subscriptionId: 'desktop-viewer:1' }))
    expect(channel.readyState).toBe(1)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(received).toEqual([[82, 70, 66]])

    fake.server().onBinary?.(new Uint8Array([1, 2]))
    channel.send(new Uint8Array([9, 8, 7]))
    expect(received).toEqual([
      [82, 70, 66],
      [1, 2]
    ])
    expect(fake.sent).toEqual([[9, 8, 7]])

    fake.server().onResponse(ok({ type: 'end', subscriptionId: 'desktop-viewer:1' }))
    expect(channel.readyState).toBe(3)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1)
    channel.send(new Uint8Array([5]))
    channel.close()
    expect(fake.sent).toEqual([[9, 8, 7]])
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('reports an error and closes when the viewer is refused', async () => {
    const fake = fakeSubscribe()
    const channel = createDesktopViewerChannel(
      { kind: 'environment', environmentId: 'env-1' },
      'viewer-1',
      fake.subscribe
    )
    const errored = vi.fn()
    const closed = vi.fn()
    channel.onerror = errored
    channel.onclose = closed
    await Promise.resolve()
    fake.server().onResponse({
      id: 'r',
      ok: false,
      error: { code: 'desktop_unavailable', message: 'The desktop is not available.' },
      _meta: { runtimeId: 'env-runtime' }
    })
    expect(errored).toHaveBeenCalledTimes(1)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(channel.readyState).toBe(3)
  })

  it('closing before the subscription settles still unsubscribes', async () => {
    const fake = fakeSubscribe()
    const channel = createDesktopViewerChannel(
      { kind: 'environment', environmentId: 'env-1' },
      'viewer-1',
      fake.subscribe
    )
    const closed = vi.fn()
    channel.onclose = closed
    channel.close()
    expect(closed).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

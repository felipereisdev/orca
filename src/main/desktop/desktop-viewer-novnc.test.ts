// @vitest-environment happy-dom
import { duplexPair, type Duplex } from 'node:stream'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { startDesktopBrokerFixture } from './testing/desktop-broker-fixture'

/** A WebSocket-shaped channel over one end of a stream pair, as noVNC's RFB accepts. */
type StreamChannel = {
  binaryType: string
  protocol: string
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null
  onerror: (() => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  send: (data: ArrayBuffer | ArrayBufferView) => void
  close: () => void
}

function streamChannel(socket: Duplex): StreamChannel {
  const channel: StreamChannel = {
    binaryType: 'arraybuffer',
    protocol: '',
    readyState: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      // Buffer.from(view) copies: noVNC reuses its send buffer as soon as this returns.
      socket.write(
        Buffer.from(
          ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data)
        )
      )
    },
    close() {
      socket.destroy()
    }
  }
  socket.on('data', (chunk: Buffer) => {
    const copy = new Uint8Array(chunk.byteLength)
    copy.set(chunk)
    channel.onmessage?.({ data: copy.buffer })
  })
  socket.once('close', () => {
    channel.readyState = 3
    channel.onclose?.({ code: 1006, reason: '' })
  })
  return channel
}

// happy-dom has no 2D canvas; noVNC only needs these calls to decode into its framebuffer.
function stubCanvas(): void {
  const context = {
    imageSmoothingEnabled: true,
    fillStyle: '',
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height
    }),
    putImageData: () => {},
    drawImage: () => {},
    fillRect: () => {},
    clearRect: () => {}
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: noVNC calls only the members stubbed above.
    () => context as unknown as CanvasRenderingContext2D
  )
  if (globalThis.ImageData === undefined) {
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number
        ) {}
      }
    )
  }
}

beforeAll(stubCanvas)

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

describe('the real noVNC client through the broker', () => {
  it('negotiates fences and continuous updates and keeps drawing without disconnecting', async () => {
    const { default: RFB } = await import('@novnc/novnc')
    const fixture = await startDesktopBrokerFixture({ width: 64, height: 48 })
    cleanups.push(() => fixture.close())
    const [brokerSide, viewerSide] = duplexPair()
    const channel = streamChannel(viewerSide)
    const opening = fixture.broker.openViewer('v1', brokerSide)
    channel.readyState = 1
    const target = document.createElement('div')
    document.body.append(target)
    const rfb = new RFB(target, channel)
    const disconnects: unknown[] = []
    rfb.addEventListener('disconnect', (event) => disconnects.push(event))
    cleanups.push(() => rfb.disconnect())
    await opening

    // noVNC answers the server's probe fence and enables continuous updates, as with TigerVNC.
    await fixture.server.waitForReceived(
      (received) =>
        received.some((message) => message[0] === 248) &&
        received.some((message) => message[0] === 150)
    )
    // A second fence is written after the framebuffer update, so its reply proves that update
    // was decoded by a client that is still connected.
    fixture.server.sendFence('after-update')
    await fixture.server.waitForReceived((received) =>
      received.some(
        (message) => message[0] === 248 && message.subarray(9).toString('latin1') === 'after-update'
      )
    )

    expect(disconnects).toEqual([])
    expect(brokerSide.destroyed).toBe(false)
  })
})

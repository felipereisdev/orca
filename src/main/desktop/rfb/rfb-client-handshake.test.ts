import { connect, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startFakeRfbServer } from '../testing/fake-rfb-server'
import { performRfbClientHandshake } from './rfb-client-handshake'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function connectTo(port: number): Promise<Socket> {
  const socket = connect({ host: '127.0.0.1', port })
  cleanups.push(() => void socket.destroy())
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  return socket
}

describe('performRfbClientHandshake', () => {
  it('client handshake against the fake server returns size and name', async () => {
    const server = await startFakeRfbServer({ password: 'abc12345', width: 640, height: 480 })
    cleanups.push(() => server.close())
    const socket = await connectTo(server.port)

    const init = await performRfbClientHandshake(socket, { password: 'abc12345', shared: true })

    expect(init).toMatchObject({ width: 640, height: 480, name: 'Orca fake desktop' })
    expect(init.pixelFormat).toHaveLength(16)
    expect(init.serverInit).toHaveLength(24 + 'Orca fake desktop'.length)
  })

  it('wrong password rejects with rfb_auth_failed', async () => {
    const server = await startFakeRfbServer({ password: 'abc12345', width: 640, height: 480 })
    cleanups.push(() => server.close())
    const socket = await connectTo(server.port)

    await expect(
      performRfbClientHandshake(socket, { password: 'wrong', shared: true })
    ).rejects.toMatchObject({ code: 'rfb_auth_failed' })
  })

  it('rejects a ServerInit larger than the framebuffer budget', async () => {
    const server = await startFakeRfbServer({ password: 'abc12345', width: 9000, height: 600 })
    cleanups.push(() => server.close())
    const socket = await connectTo(server.port)

    await expect(
      performRfbClientHandshake(socket, { password: 'abc12345', shared: true })
    ).rejects.toMatchObject({ code: 'rfb_framebuffer_too_large' })
  })
})

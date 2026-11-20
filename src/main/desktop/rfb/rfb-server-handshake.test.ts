import { connect, createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { runRfbServerHandshake } from './rfb-server-handshake'
import { readExact } from './rfb-stream-reader'

const SERVER_INIT = Buffer.concat([
  Buffer.from([0x03, 0x20, 0x02, 0x58]),
  Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]),
  Buffer.from([0, 0, 0, 4]),
  Buffer.from('desk')
])

let server: Server | undefined
let client: Socket | undefined

afterEach(async () => {
  client?.destroy()
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

describe('runRfbServerHandshake', () => {
  it('server handshake leads a client to receive the cached ServerInit', async () => {
    let handshake: Promise<void> | undefined
    server = createServer((socket) => {
      handshake = runRfbServerHandshake(socket, SERVER_INIT)
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const socket = connect({ host: '127.0.0.1', port })
    client = socket

    expect((await readExact(socket, 12)).toString('latin1')).toBe('RFB 003.008\n')
    socket.write('RFB 003.008\n')
    expect(await readExact(socket, 2)).toEqual(Buffer.from([1, 1]))
    socket.write(Buffer.from([1]))
    expect(await readExact(socket, 4)).toEqual(Buffer.from([0, 0, 0, 0]))
    socket.write(Buffer.from([1]))

    expect(await readExact(socket, SERVER_INIT.length)).toEqual(SERVER_INIT)
    await expect(handshake).resolves.toBeUndefined()
  })
})

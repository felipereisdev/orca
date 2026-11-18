import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { RFB_PROTOCOL_VERSION } from '../rfb/rfb-protocol'
import { readExact, readRfbString } from '../rfb/rfb-stream-reader'
import { startFakeRfbServer } from './fake-rfb-server'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

describe('startFakeRfbServer', () => {
  it('refuses a client that selects a security type it did not offer', async () => {
    const server = await startFakeRfbServer({ password: 'pw', width: 8, height: 8 })
    cleanups.push(() => server.close())
    const socket = connect({ host: '127.0.0.1', port: server.port })
    cleanups.push(() => void socket.destroy())

    await readExact(socket, 12)
    socket.write(RFB_PROTOCOL_VERSION)
    await readExact(socket, 2)
    socket.write(Buffer.from([1]))

    expect((await readExact(socket, 4)).readUInt32BE(0)).toBe(1)
    expect((await readRfbString(socket)).text).toBe('Security type not offered')
  })
})

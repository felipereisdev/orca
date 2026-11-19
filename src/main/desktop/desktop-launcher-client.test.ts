import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { runOnLauncher, type LauncherEndpoint } from './desktop-launcher-client'
import { startFakeDesktopLauncher, type FakeDesktopLauncher } from './testing/fake-desktop-launcher'

const TOKEN = 'launcher-token-0b9c7e1d4a2f48e6b3c5d7a9e1f3b5c7'
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

/** A listener on the launcher port that does not know the token. */
async function startImpostor(
  reply: (line: string) => unknown
): Promise<{ port: number; received: () => string }> {
  let received = ''
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', (chunk: string) => {
      received += chunk
      for (const line of chunk.split('\n').filter(Boolean)) {
        const answer = reply(line)
        socket.write(typeof answer === 'string' ? answer : `${JSON.stringify(answer)}\n`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      })
  )
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('impostor has no TCP address')
  }
  return { port: address.port, received: () => received }
}

async function launcher(): Promise<FakeDesktopLauncher> {
  const fake = await startFakeDesktopLauncher(TOKEN)
  cleanups.push(() => fake.close())
  return fake
}

function run(
  endpoint: LauncherEndpoint,
  argv: string[]
): Promise<{ exit?: number; output: string }> {
  let output = ''
  return runOnLauncher(
    endpoint,
    { argv },
    {
      signal: new AbortController().signal,
      onStarted: () => {},
      onOutput: (_stream, data) => {
        output += data
      }
    }
  ).then((exit) => ({ exit, output }))
}

describe('runOnLauncher', () => {
  it('refuses a listener that cannot prove the token and sends it nothing secret', async () => {
    const impostor = await startImpostor(() => ({ nonce: 'a'.repeat(64), proof: 'b'.repeat(64) }))

    await expect(
      run({ host: '127.0.0.1', port: impostor.port, token: TOKEN }, ['echo', 'hi'])
    ).rejects.toMatchObject({
      code: 'desktop_launcher_rejected'
    })
    const lines = impostor.received().split('\n').filter(Boolean)
    expect(lines.map((line) => JSON.parse(line).op)).toEqual(['hello'])
    expect(impostor.received()).not.toContain(TOKEN)
    expect(impostor.received()).not.toContain('argv')
  })

  it('refuses a listener that skips the handshake', async () => {
    const impostor = await startImpostor(() => ({ id: 'run-1' }))

    await expect(
      run({ host: '127.0.0.1', port: impostor.port, token: TOKEN }, ['echo', 'hi'])
    ).rejects.toMatchObject({
      code: 'desktop_launcher_rejected'
    })
    expect(impostor.received().split('\n').filter(Boolean)).toHaveLength(1)
  })

  // Same string length as a real proof but other byte lengths or alphabets, a short proof, and
  // a line that is not JSON: each is a rejection, never a throw out of the socket callback.
  it.each([
    ['a multi-byte proof of the same length', { nonce: 'a'.repeat(64), proof: 'é'.repeat(64) }],
    ['a non-hex proof', { nonce: 'a'.repeat(64), proof: 'z'.repeat(64) }],
    ['a truncated proof', { nonce: 'a'.repeat(64), proof: 'ab'.repeat(5) }],
    ['invalid JSON before authentication', 'this is not json\n']
  ])('refuses %s as desktop_launcher_rejected', async (_label, answer) => {
    const impostor = await startImpostor(() => answer)

    await expect(
      run({ host: '127.0.0.1', port: impostor.port, token: TOKEN }, ['echo', 'hi'])
    ).rejects.toMatchObject({ code: 'desktop_launcher_rejected' })
    expect(impostor.received().split('\n').filter(Boolean)).toHaveLength(1)
  })

  it('runs on the real launcher without the token ever crossing the connection', async () => {
    const fake = await launcher()

    await expect(
      run({ host: '127.0.0.1', port: fake.port, token: TOKEN }, ['echo', 'hi'])
    ).resolves.toEqual({
      exit: 0,
      output: 'hi\n'
    })
    expect(fake.received()).not.toContain(TOKEN)
  })

  it('a wrong token is refused before anything runs', async () => {
    const fake = await launcher()

    await expect(
      run({ host: '127.0.0.1', port: fake.port, token: `${TOKEN}-wrong` }, ['echo', 'hi'])
    ).rejects.toMatchObject({ code: 'desktop_launcher_rejected' })
    expect(fake.runs).toEqual([])
  })
})

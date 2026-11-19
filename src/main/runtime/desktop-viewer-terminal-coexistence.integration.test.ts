import type * as WorktreeScanCacheModule from '../git/worktrees/catalog/worktree-scan-cache'
import type * as WorktreeListingModule from '../git/worktrees/catalog/worktree-listing'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../shared/remote-runtime/pairing/pairing'
import { sendRemoteRuntimeRequestOnSocket } from '../../shared/remote-runtime/requests/remote-runtime-request-socket'
import { subscribeRemoteRuntimeTransport } from '../../shared/remote-runtime/requests/remote-runtime-subscription-transport'
import type { RemoteRuntimeTransportSubscription } from '../../shared/remote-runtime/requests/remote-runtime-subscription-contract'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson
} from '../../shared/terminal/stream/terminal-stream-protocol'
import { getDesktopBroker } from '../desktop/desktop-broker-instance'
import { FIXTURE_PASSWORD, pointerEvents } from '../desktop/testing/desktop-broker-fixture'
import { startFakeRfbServer } from '../desktop/testing/fake-rfb-server'
import { connectFakeRfbViewer } from '../desktop/testing/fake-rfb-viewer'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './rpc/server/runtime-rpc'
import { readRuntimeMetadata } from './rpc/server/runtime-metadata'
import { sendRequest } from './rpc/server/runtime-rpc-test-harness'
import { makeStore } from './rpc/server/runtime-rpc-worktree-store-fixtures'
import { partialRuntimeStore } from './construction/test-context/runtime-store-partial-fixture'
import { settledWriteStub } from '../providers/testing/settled-pty-write-stub'
import { publishHeadlessRuntimeGraph } from './session-graph/headless-runtime-graph'
import { committingSpawn } from './terminal/layout/bind-first-pane.test-fixture'

vi.mock('../git/worktrees/catalog/worktree-scan-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreeScanCacheModule>()),
  listWorktrees: getWorktreeListingMocks().listWorktrees
}))

vi.mock('../git/worktrees/catalog/worktree-listing', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreeListingModule>()),
  listWorktreesStrict: getWorktreeListingMocks().listWorktreesStrict
}))

const { getWorktreeListingMocks } = vi.hoisted(() => {
  const worktrees = [
    { path: '/tmp/worktree-a', head: 'abc', branch: 'a', isBare: false, isMainWorktree: false }
  ]
  const listings = {
    listWorktrees: vi.fn().mockResolvedValue(worktrees),
    listWorktreesStrict: vi.fn().mockResolvedValue(worktrees)
  }
  return { getWorktreeListingMocks: () => listings }
})

const PTY_ID = 'coexist-pty'
const WORKTREE = 'id:repo-1::/tmp/worktree-a'
const SLOW_WAIT = { timeout: 5_000 }
const Typed = z.object({ type: z.string().optional(), streamId: z.number().optional() }).loose()

async function call(
  connection: PairedRuntimeConnection,
  method: string,
  params: unknown
): Promise<{ ok: boolean; result?: unknown; error?: { code?: string } }> {
  return sendRemoteRuntimeRequestOnSocket(connection, method, params, 15_000)
}

/** A terminal stream on its own `terminal.multiplex` subscription, as the renderer opens it. */
async function attachTerminal(connection: PairedRuntimeConnection, terminal: string) {
  const responses: z.infer<typeof Typed>[] = []
  const frames: ReturnType<typeof decodeTerminalStreamFrame>[] = []
  const subscription = await subscribeRemoteRuntimeTransport(
    connection,
    'terminal.multiplex',
    {},
    15_000,
    {
      onResponse: (response) =>
        responses.push(response.ok ? (Typed.safeParse(response.result).data ?? {}) : {}),
      onBinary: (bytes) => frames.push(decodeTerminalStreamFrame(bytes)),
      onError: () => {}
    }
  )
  await vi.waitFor(() => expect(responses.some((r) => r.type === 'ready')).toBe(true), SLOW_WAIT)
  subscription.sendBinary(
    encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Subscribe,
      streamId: 0,
      seq: 1,
      payload: encodeTerminalStreamJson({
        streamId: 7,
        terminal,
        client: { id: 'desktop', type: 'desktop' },
        viewport: { cols: 80, rows: 24 },
        capabilities: { ackOutput: 1, writeUnavailable: 1, inputAck: 1 },
        inputSessionId: 'coexist-input'
      })
    })
  )
  await vi.waitFor(
    () => expect(responses.some((r) => r.type === 'subscribed' && r.streamId === 7)).toBe(true),
    SLOW_WAIT
  )
  return {
    subscription,
    output: () =>
      frames
        .filter((f) => f?.opcode === TerminalStreamOpcode.Output && f.streamId === 7)
        .map((f) => decodeTerminalStreamText(f!.payload))
        .join('')
  }
}

/**
 * A `desktop.viewer` subscription carrying RFB bytes for a fake viewer, each on its own server
 * connection like the renderer's channel.
 */
async function openViewer(
  connection: PairedRuntimeConnection,
  viewerId: string,
  controllerToken: string
) {
  let subscription: RemoteRuntimeTransportSubscription | undefined
  const viewer = await connectFakeRfbViewer(async (downstream: Duplex) => {
    let ready = (): void => {}
    const readyReply = new Promise<void>((resolve) => (ready = resolve))
    subscription = await subscribeRemoteRuntimeTransport(
      connection,
      'desktop.viewer',
      { viewerId, controllerToken },
      15_000,
      {
        onResponse: (response) => {
          if (response.ok && Typed.safeParse(response.result).data?.type === 'ready') {
            ready()
          }
        },
        onBinary: (bytes) => downstream.write(Buffer.from(bytes)),
        onError: () => downstream.destroy()
      }
    )
    downstream.on('data', (chunk: Buffer) => subscription?.sendBinary(new Uint8Array(chunk)))
    await readyReply
  })
  return { viewer, close: () => subscription?.close() }
}

describe('a desktop viewer next to a terminal stream on the production transport', () => {
  const cleanups: (() => unknown)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup()
    }
  })

  it('both viewers and the terminal keep working, each on its own connection', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-desktop-coexist-'))
    cleanups.push(() => rmSync(userDataPath, { recursive: true, force: true }))
    const writes: string[] = []
    const runtime = new OrcaRuntimeService(partialRuntimeStore(makeStore()))
    runtime.setPtyController({
      spawn: committingSpawn(runtime, vi.fn().mockResolvedValue({ id: PTY_ID })),
      write: (_ptyId, data) => {
        writes.push(data)
        return true
      },
      writeWithSettlement: settledWriteStub((_ptyId, data) => {
        writes.push(data)
      }),
      resize: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    publishHeadlessRuntimeGraph(runtime)
    const server = new OrcaRuntimeRpcServer({
      runtime,
      userDataPath,
      enableWebSocket: true,
      wsPort: 0
    })
    await server.start()
    cleanups.push(() => server.stop())
    const vnc = await startFakeRfbServer({ password: FIXTURE_PASSWORD, width: 64, height: 48 })
    cleanups.push(() => vnc.close())
    cleanups.push(() => getDesktopBroker().close())
    const offer = server.createPairingOffer({ address: '127.0.0.1', name: 'mac', scope: 'runtime' })
    if (!offer.available) {
      throw new Error('pairing unavailable')
    }
    const mac = pairedRuntimeConnectionFromOffer(parsePairingCode(offer.pairingUrl)!)
    const metadata = readRuntimeMetadata(userDataPath)!
    const created = await sendRequest(metadata.transports[0]!.endpoint, {
      id: 'create',
      authToken: metadata.authToken,
      method: 'terminal.create',
      params: {
        worktree: WORKTREE,
        command: 'shell',
        tabId: 'tab-1',
        leafId: '11111111-1111-4111-8111-111111111111',
        cols: 80,
        rows: 24
      }
    })
    const handle = z.object({ terminal: z.object({ handle: z.string() }) }).parse(created.result)
      .terminal.handle

    const configured = await call(mac, 'desktop.configure', {
      host: '127.0.0.1',
      port: vnc.port,
      password: FIXTURE_PASSWORD
    })
    const controllerToken = z
      .object({ controllerToken: z.string() })
      .parse(configured.result).controllerToken
    const terminal = await attachTerminal(mac, handle)
    cleanups.push(() => terminal.subscription.close())
    const first = await openViewer(mac, 'viewer-1', controllerToken)
    cleanups.push(() => first.close())
    const second = await openViewer(mac, 'viewer-2', controllerToken)
    cleanups.push(() => second.close())

    // Each viewer has a desktop of its own, and the first one can take control and click.
    expect([first.viewer.width, second.viewer.height]).toEqual([64, 48])
    const control = await call(mac, 'desktop.control.set', {
      owner: 'user',
      viewerId: 'viewer-1',
      controllerToken
    })
    expect(control).toMatchObject({ ok: true })
    first.viewer.pointer(9, 8, 1)
    second.viewer.pointer(1, 1, 1)
    await vnc.waitForReceived((received) => pointerEvents(received).length > 0)
    second.viewer.requestUpdate(false, 64, 48)
    await expect(second.viewer.readUpdate()).resolves.not.toHaveLength(0)

    // The terminal stream next to them is unaffected, both ways.
    runtime.onPtyData(PTY_ID, 'still-flowing\r\n', 1)
    await vi.waitFor(() => expect(terminal.output()).toContain('still-flowing'), SLOW_WAIT)
    expect(pointerEvents(vnc.received)).toEqual([[1, 9, 8]])
  })
})

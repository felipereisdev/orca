import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, symlink, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIXTURE_PASSWORD,
  keyEvents,
  pointerEvents
} from '../../../../desktop/testing/desktop-broker-fixture'
import { startFakeRfbServer, type FakeRfbServer } from '../../../../desktop/testing/fake-rfb-server'
import {
  createDesktopRpcHarness,
  LOCAL_AGENT,
  MAC,
  MAC_AGENT
} from './desktop-methods-test-harness'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const posixOnly = process.platform === 'win32' ? it.skip : it

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function vncServer(): Promise<FakeRfbServer> {
  const server = await startFakeRfbServer({ password: FIXTURE_PASSWORD, width: 64, height: 48 })
  cleanups.push(() => server.close())
  return server
}

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-screenshot-test-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function setup(root?: string) {
  const server = await vncServer()
  const harness = createDesktopRpcHarness(undefined, root ? { tmpDir: () => root } : {})
  cleanups.push(() => harness.broker.close())
  await harness.configure(server, MAC)
  return { server, ...harness }
}

describe('desktop agent action methods', () => {
  it('desktop.click from an agent caller reaches the broker', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { server, call } = await setup()

    const marked = await call('desktop.click', { x: 10, y: 11 }, MAC_AGENT)
    const local = await call('desktop.click', { x: 3, y: 4, button: 'right' }, LOCAL_AGENT)
    await server.waitForReceived((received) => pointerEvents(received).length >= 6)

    expect(marked).toMatchObject({ ok: true })
    expect(local).toMatchObject({ ok: true })
    expect(pointerEvents(server.received)).toEqual([
      [0, 10, 11],
      [1, 10, 11],
      [0, 10, 11],
      [0, 3, 4],
      [4, 3, 4],
      [0, 3, 4]
    ])
  })

  it('desktop.click returns desktop_user_in_control while the user owns the desktop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { server, broker, call } = await setup()
    broker.setOwner('user', 'v1')

    const click = await call('desktop.click', { x: 10, y: 11 }, MAC_AGENT)

    expect(click).toMatchObject({
      ok: false,
      error: {
        code: 'desktop_user_in_control',
        message: 'The user has taken control of the desktop.'
      }
    })
    expect(pointerEvents(server.received)).toEqual([])
  })

  it('desktop.screenshot writes a PNG and returns its path', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const root = await tempRoot()
    const { broker, call } = await setup(root)
    broker.setOwner('user', 'v1')
    const out = join(root, 'chosen.png')

    const automatic = await call('desktop.screenshot', {}, MAC_AGENT)
    const chosen = await call('desktop.screenshot', { out }, MAC_AGENT)

    const path = String(automatic.result?.path)
    expect(automatic).toMatchObject({ ok: true, result: { width: 64, height: 48 } })
    expect(path.startsWith(join(root, 'orca-desktop', 'screenshot-'))).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(chosen).toMatchObject({ ok: true, result: { path: out, width: 64, height: 48 } })
    for (const file of [path, out]) {
      expect((await readFile(file)).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    }
  })

  posixOnly('desktop.screenshot keeps its directory 0700 and files 0600', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const root = await tempRoot()
    const { call } = await setup(root)
    await mkdir(join(root, 'orca-desktop'), { mode: 0o777 })

    const shot = await call('desktop.screenshot', {}, MAC_AGENT)

    expect((await stat(join(root, 'orca-desktop'))).mode & 0o777).toBe(0o700)
    expect((await stat(String(shot.result?.path))).mode & 0o777).toBe(0o600)
  })

  posixOnly('desktop.screenshot refuses a symlinked screenshot directory', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const root = await tempRoot()
    const elsewhere = await tempRoot()
    const { call } = await setup(root)
    await symlink(elsewhere, join(root, 'orca-desktop'))

    const shot = await call('desktop.screenshot', {}, MAC_AGENT)

    expect(shot).toMatchObject({ ok: false, error: { code: 'desktop_screenshot_failed' } })
  })

  posixOnly('desktop.screenshot refuses an out path that is a FIFO or a symlink', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const root = await tempRoot()
    const { call } = await setup(root)
    const fifo = join(root, 'pipe.png')
    execFileSync('mkfifo', [fifo])
    const target = join(root, 'target.txt')
    await writeFile(target, 'keep')
    const link = join(root, 'link.png')
    await symlink(target, link)

    const toFifo = await call('desktop.screenshot', { out: fifo }, MAC_AGENT)
    const toLink = await call('desktop.screenshot', { out: link }, MAC_AGENT)

    expect(toFifo).toMatchObject({ ok: false, error: { code: 'desktop_invalid_input' } })
    expect(toLink).toMatchObject({ ok: false, error: { code: 'desktop_invalid_input' } })
    expect(await readFile(target, 'utf8')).toBe('keep')
  })

  it('desktop.screenshot accepts a destination name of 255 bytes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const root = await tempRoot()
    const { call } = await setup(root)
    const out = join(root, `${'a'.repeat(251)}.png`)

    const shot = await call('desktop.screenshot', { out }, MAC_AGENT)

    expect(shot).toMatchObject({ ok: true, result: { path: out } })
    expect((await readFile(out)).subarray(0, 8)).toEqual(PNG_SIGNATURE)
  })

  posixOnly('desktop.screenshot overwriting an existing out file leaves it 0600', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const root = await tempRoot()
    const { call } = await setup(root)
    const out = join(root, 'shot.png')
    await writeFile(out, 'old')
    await chmod(out, 0o644)

    const shot = await call('desktop.screenshot', { out }, MAC_AGENT)

    expect(shot).toMatchObject({ ok: true, result: { path: out } })
    expect((await readFile(out)).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect((await stat(out)).mode & 0o777).toBe(0o600)
  })

  it('desktop.type rejects text over 10 000 chars', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { server, call } = await setup()

    const typed = await call('desktop.type', { text: 'a'.repeat(10_001) }, MAC_AGENT)

    expect(typed).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(keyEvents(server.received)).toEqual([])
  })
})

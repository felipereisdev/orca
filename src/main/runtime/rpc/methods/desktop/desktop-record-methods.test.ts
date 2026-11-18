import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopBroker } from '../../../../desktop/desktop-broker'
import { FIXTURE_PASSWORD } from '../../../../desktop/testing/desktop-broker-fixture'
import { createFakeFfmpeg } from '../../../../desktop/testing/fake-ffmpeg'
import { startFakeRfbServer } from '../../../../desktop/testing/fake-rfb-server'
import {
  createDesktopRpcHarness,
  LOCAL_AGENT,
  MAC,
  MAC_AGENT
} from './desktop-methods-test-harness'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) {
    await cleanups.pop()?.()
  }
})

async function setup({
  ffmpegPath = '/usr/bin/ffmpeg',
  findFfmpeg = () => ffmpegPath
}: {
  ffmpegPath?: string | null
  findFfmpeg?: () => string | null | Promise<string | null>
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-record-rpc-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const vnc = await startFakeRfbServer({ password: FIXTURE_PASSWORD, width: 64, height: 48 })
  cleanups.push(() => vnc.close())
  const ffmpeg = createFakeFfmpeg()
  const broker = new DesktopBroker({
    recorder: { findFfmpeg, spawnFfmpeg: ffmpeg.spawn }
  })
  const harness = createDesktopRpcHarness(broker, { recordingsDir: () => dir })
  cleanups.push(() => broker.close())
  return { ...harness, vnc, ffmpeg, dir }
}

describe('desktop recording methods', () => {
  it('records on request and tells the controller when the recording finished', async () => {
    const { call, configure, stream, vnc, dir } = await setup()
    await configure(vnc, MAC)
    const events = stream('desktop.events', {}, MAC, AbortSignal.timeout(10_000))
    await events.waitForReplies((replies) => replies.length > 0)

    const started = await call('desktop.record.start', {}, MAC_AGENT)
    expect(started.result).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{16}$/),
      path: join(dir, `rec-${String(started.result?.id)}.mp4`)
    })
    expect((await call('desktop.status', {}, MAC_AGENT)).result?.recording).toBe(true)
    expect((await call('desktop.record.start', {}, MAC_AGENT)).error?.code).toBe(
      'desktop_already_recording'
    )

    const stopped = await call('desktop.record.stop', {}, MAC_AGENT)
    expect(stopped.result).toEqual({
      ...started.result,
      seconds: 0.1,
      bytes: 100,
      stopped: 'requested'
    })
    await events.waitForReplies((replies) => replies.length > 1)
    expect(events.replies.map((reply) => reply.result)).toEqual([
      { type: 'ready', subscriptionId: expect.stringMatching(/^desktop-events:/) },
      { type: 'recording-finished', id: started.result?.id, path: started.result?.path, bytes: 100 }
    ])
    expect((await call('desktop.status', {}, MAC_AGENT)).result?.recording).toBe(false)
  })

  it('lists the recordings on the environment', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { call, configure, vnc, dir } = await setup()
    await configure(vnc, MAC)
    const started = await call('desktop.record.start', { maxSeconds: 5 }, MAC_AGENT)
    await vi.advanceTimersByTimeAsync(300)
    await call('desktop.record.stop', {}, MAC_AGENT)

    expect((await call('desktop.recordings.list', {}, MAC_AGENT)).result).toEqual({
      recordings: [
        {
          id: started.result?.id,
          path: join(dir, `rec-${String(started.result?.id)}.mp4`),
          bytes: 300,
          createdAt: expect.any(String)
        }
      ]
    })
  })

  it('record.stop with nothing running → desktop_not_recording', async () => {
    const { call, configure, vnc } = await setup()
    await configure(vnc, MAC)

    expect((await call('desktop.record.stop', {}, MAC_AGENT)).error?.code).toBe(
      'desktop_not_recording'
    )
  })

  it('missing ffmpeg → desktop_recording_unavailable', async () => {
    const { call, configure, vnc, ffmpeg } = await setup({ ffmpegPath: null })
    await configure(vnc, MAC)

    expect((await call('desktop.record.start', {}, MAC_AGENT)).error?.code).toBe(
      'desktop_recording_unavailable'
    )
    expect(ffmpeg.spawns).toEqual([])
  })

  it('a broker closed while record.start is setting up never spawns ffmpeg', async () => {
    let resolveFfmpeg = (_path: string): void => {}
    const lookup = new Promise<string>((resolve) => {
      resolveFfmpeg = resolve
    })
    let reached = (): void => {}
    const startReachedLookup = new Promise<void>((resolve) => {
      reached = resolve
    })
    const { call, configure, vnc, ffmpeg, broker } = await setup({
      findFfmpeg: () => {
        reached()
        return lookup
      }
    })
    await configure(vnc, MAC)

    const starting = call('desktop.record.start', {}, MAC_AGENT)
    await startReachedLookup
    broker.close()
    resolveFfmpeg('/usr/bin/ffmpeg')

    expect((await starting).error?.code).toBe('desktop_unavailable')
    expect(ffmpeg.spawns).toEqual([])
  })

  it('refuses agent callers on desktop.events', async () => {
    const { configure, stream, vnc } = await setup()
    await configure(vnc, MAC)

    for (const agent of [MAC_AGENT, LOCAL_AGENT]) {
      const events = stream('desktop.events', {}, agent)
      await events.done
      expect(events.replies.map((reply) => reply.error?.code)).toEqual([
        'desktop_agent_not_allowed'
      ])
    }
  })
})

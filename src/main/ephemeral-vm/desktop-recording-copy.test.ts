import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import { desktopEnvironmentFake as env } from './desktop-environment-fake.test-support'

type Disk = {
  maxWriteBytes: number
  // Runs right after the handle's fsync or close, before the copy resumes.
  afterSync: (() => void) | null
  afterClose: (() => void) | null
}
const disk = vi.hoisted((): Disk => ({
  maxWriteBytes: Number.POSITIVE_INFINITY,
  afterSync: null,
  afterClose: null
}))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', async () =>
  (await import('./desktop-environment-fake.test-support')).fakeTransportRoutingModule()
)
// A disk that accepts at most `maxWriteBytes` per write call, as a full or slow volume can.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  const open: typeof actual.open = async (...args) => {
    const handle = await actual.open(...args)
    const write = handle.write.bind(handle)
    const sync = handle.sync.bind(handle)
    const close = handle.close.bind(handle)
    return Object.assign(handle, {
      write: (buffer: Uint8Array, offset: number, length: number, position: number) =>
        write(buffer, offset, Math.min(length, disk.maxWriteBytes), position),
      sync: async () => {
        await sync()
        disk.afterSync?.()
      },
      close: async () => {
        await close()
        disk.afterClose?.()
      }
    })
  }
  return { ...actual, open, default: { ...actual, open } }
})

import { copyEnvironmentRecording } from './desktop-recording-copy'

describe('copyEnvironmentRecording', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-desktop-copy-'))
  })
  afterEach(async () => {
    disk.maxWriteBytes = Number.POSITIVE_INFINITY
    disk.afterSync = null
    disk.afterClose = null
    env.reset()
    await removeTempDirs([dir])
  })

  it('writes every byte of a chunk the disk accepts only in part', async () => {
    disk.maxWriteBytes = 1_000
    const recording = env.finishRecording('0123456789abcdef', 300_000)
    const destination = join(dir, 'rec-0123456789abcdef.mp4')

    await copyEnvironmentRecording({
      environmentId: 'env-1',
      workspaceId: 'ws-1',
      recording,
      destination,
      signal: new AbortController().signal
    })

    expect(readFileSync(destination).equals(env.files.get(recording.path)!)).toBe(true)
  })

  it('a disk that stops writing fails the copy before publishing', async () => {
    disk.maxWriteBytes = 0
    const recording = env.finishRecording('0123456789abcdef', 1_000)

    await expect(
      copyEnvironmentRecording({
        environmentId: 'env-1',
        workspaceId: 'ws-1',
        recording,
        destination: join(dir, 'rec-0123456789abcdef.mp4'),
        signal: new AbortController().signal
      })
    ).rejects.toThrow('The recording copy stopped writing.')
    expect(readdirSync(dir)).toEqual([])
  })

  for (const step of ['afterSync', 'afterClose'] as const) {
    it(`a copy cancelled during ${step === 'afterSync' ? 'fsync' : 'close'} publishes no file and removes the temp file`, async () => {
      const recording = env.finishRecording('0123456789abcdef', 1_000)
      const controller = new AbortController()
      disk[step] = () => controller.abort()

      await expect(
        copyEnvironmentRecording({
          environmentId: 'env-1',
          workspaceId: 'ws-1',
          recording,
          destination: join(dir, 'rec-0123456789abcdef.mp4'),
          signal: controller.signal
        })
      ).rejects.toThrow()
      expect(readdirSync(dir)).toEqual([])
    })
  }
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { noteCopiedRecording } from '../../../../ephemeral-vm/desktop-recording-copies'
import { createDesktopRpcHarness, LOCAL_AGENT } from './desktop-methods-test-harness'

const PHONE = { pairedDeviceId: 'phone-1', clientKind: 'mobile' as const }
const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() ?? '', { recursive: true, force: true })
  }
})

describe('desktop recording copy methods', () => {
  it("pages the Mac's copy of a recording for a phone", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-recording-copy-rpc-'))
    dirs.push(dir)
    const path = join(dir, 'rec-00000000000000c3.mp4')
    writeFileSync(path, 'abcdefgh')
    noteCopiedRecording('00000000000000c3', path)
    const { call } = createDesktopRpcHarness()

    const stat = await call(
      'desktop.recordings.copyStat',
      { recordingId: '00000000000000c3' },
      PHONE
    )
    const chunk = await call(
      'desktop.recordings.copyReadChunk',
      { recordingId: '00000000000000c3', offset: 2, length: 4 },
      PHONE
    )

    expect(stat.result).toEqual({
      size: 8,
      isDirectory: false,
      mtime: expect.any(Number),
      ctime: expect.any(Number)
    })
    expect(chunk.result).toEqual({
      contentBase64: Buffer.from('cdef').toString('base64'),
      bytesRead: 4,
      eof: false
    })
  })

  it('refuses a recording the Mac never copied', async () => {
    const { call } = createDesktopRpcHarness()
    const reply = await call(
      'desktop.recordings.copyStat',
      { recordingId: '00000000000000d4' },
      LOCAL_AGENT
    )
    expect(reply.error?.code).toBe('desktop_recording_not_found')
    expect(
      (await call('desktop.recordings.copyStat', { recordingId: '../x' }, LOCAL_AGENT)).ok
    ).toBe(false)
  })
})

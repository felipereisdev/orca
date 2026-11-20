import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence/loading-store/store'

const { authorize } = vi.hoisted(() => ({
  authorize: vi.fn(async (filePath: string) => filePath)
}))
vi.mock('electron', () => ({
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }
}))
vi.mock('../ipc/filesystem/access/local-file-access-resolution', () => ({
  resolveLocalFileRequestPath: authorize
}))
vi.mock('../ipc/runtime-environments/catalog/runtime-environment-registry-root', () => ({
  readRegisteredPairingRevision: vi.fn(async () => 1)
}))
import { handleMediaPreviewRequest } from './media-preview-protocol'
import { grantDesktopRecordingPreview } from './desktop-recording-preview'
import { noteCopiedRecording } from '../ephemeral-vm/desktop-recording-copies'

describe('desktop recording preview', () => {
  let directory: string
  const emitter = new EventEmitter()
  const event = {
    sender: {
      id: 51234,
      on: vi.fn().mockImplementation((name, callback) => emitter.on(name, callback)),
      removeListener: vi
        .fn()
        .mockImplementation((name, callback) => emitter.removeListener(name, callback))
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked authorization resolver never reads Store members.
  const store = {} as Store

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-recording-preview-'))
  })
  afterEach(async () => {
    emitter.emit('destroyed')
    await rm(directory, { recursive: true, force: true })
  })

  it('media path resolution serves mp4 with video/mp4', async () => {
    const filePath = join(directory, 'rec-00000000000000a1.mp4')
    await writeFile(filePath, Buffer.from('0123456789'))
    noteCopiedRecording('00000000000000a1', filePath)

    const preview = await grantDesktopRecordingPreview(event, '00000000000000a1', store)
    const response = await handleMediaPreviewRequest(
      new Request(preview?.mediaUrl ?? '', { headers: { Range: 'bytes=2-5' } })
    )

    expect(preview?.mimeType).toBe('video/mp4')
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('2345')
  })

  it('grants nothing for a recording the Mac never copied', async () => {
    await expect(grantDesktopRecordingPreview(event, '00000000000000b2', store)).resolves.toBeNull()
    await expect(grantDesktopRecordingPreview(event, '../../etc', store)).resolves.toBeNull()
  })
})

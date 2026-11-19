import { describe, expect, it } from 'vitest'
import { stubRpcClient } from '../../../transport/rpc/rpc-client-test-stub'
import type { MobileMediaSink } from '../../../files/media/mobile-file-media-download'
import { downloadHostChatVideo } from './mobile-native-chat-video-read'

const RECORDING = '/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4'
const BYTES = 'video!'

function memorySink(): MobileMediaSink & { bytes: () => string } {
  let parts: Uint8Array[] = []
  return {
    append: (bytes) => parts.push(bytes),
    finish: () => `blob:${Buffer.concat(parts).toString()}`,
    dispose: () => {
      parts = []
    },
    bytes: () => Buffer.concat(parts).toString()
  }
}

function hostClient(replies: Record<string, (params: Record<string, unknown>) => unknown>) {
  const sent: { method: string; params: Record<string, unknown> }[] = []
  const client = stubRpcClient({
    sendRequest: (method, params) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every request this test sees carries an object.
      const record = params as Record<string, unknown>
      sent.push({ method, params: record })
      const reply = replies[method]
      if (!reply) {
        return Promise.resolve({
          id: method,
          ok: false,
          error: { code: 'runtime_unavailable', message: 'environment gone' }
        })
      }
      return Promise.resolve({ id: method, ok: true, result: reply(record) })
    }
  })
  return { client, sent }
}

const stat = () => ({ size: BYTES.length, isDirectory: false, mtime: 1, ctime: 1 })
const chunk = (params: Record<string, unknown>) => {
  const offset = Number(params.offset)
  const bytes = Buffer.from(BYTES).subarray(offset, offset + Number(params.length))
  return {
    contentBase64: bytes.toString('base64'),
    bytesRead: bytes.byteLength,
    eof: offset + bytes.byteLength >= BYTES.length
  }
}

describe('downloadHostChatVideo', () => {
  it("streams an environment recording through the host's grant", async () => {
    const { client, sent } = hostClient({
      'files.resolveTerminalPath': () => ({
        exists: true,
        openTarget: { kind: 'absolute-file', absolutePath: RECORDING, grantId: 'g-1' }
      }),
      'files.statTerminalArtifact': stat,
      'files.readTerminalArtifactChunk': chunk
    })
    const sink = memorySink()

    const uri = await downloadHostChatVideo(
      { client, worktreeId: 'wt-1' },
      RECORDING,
      () => sink,
      new AbortController().signal,
      () => {}
    )

    expect(uri).toBe(`blob:${BYTES}`)
    expect(sent.find((call) => call.method === 'files.readTerminalArtifactChunk')?.params).toEqual(
      expect.objectContaining({ worktree: 'id:wt-1', grantId: 'g-1', absolutePath: RECORDING })
    )
    expect(sent.some((call) => call.method.startsWith('desktop.'))).toBe(false)
  })

  it('a recording whose environment is gone plays from the Mac copy', async () => {
    const { client, sent } = hostClient({
      'desktop.recordings.copyStat': stat,
      'desktop.recordings.copyReadChunk': chunk
    })
    const sinks: ReturnType<typeof memorySink>[] = []

    const uri = await downloadHostChatVideo(
      { client, worktreeId: 'wt-1' },
      RECORDING,
      () => {
        const sink = memorySink()
        sinks.push(sink)
        return sink
      },
      new AbortController().signal,
      () => {}
    )

    expect(uri).toBe(`blob:${BYTES}`)
    expect(sent.find((call) => call.method === 'desktop.recordings.copyReadChunk')?.params).toEqual(
      expect.objectContaining({ recordingId: '0123456789abcdef', offset: 0 })
    )
  })

  it('has no copy to fall back on for a video that is not a recording', async () => {
    const { client, sent } = hostClient({})
    await expect(
      downloadHostChatVideo(
        { client, worktreeId: 'wt-1' },
        '/home/dev/demo.mp4',
        memorySink,
        new AbortController().signal,
        () => {}
      )
    ).rejects.toThrow()
    expect(sent.some((call) => call.method.startsWith('desktop.'))).toBe(false)
  })
})

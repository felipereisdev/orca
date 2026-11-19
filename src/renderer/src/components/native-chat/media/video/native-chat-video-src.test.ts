import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireTerminalArtifactGrant: vi.fn(),
  readRuntimeTerminalArtifactContent: vi.fn(),
  readRuntimeFileContent: vi.fn(),
  grantDesktopRecordingPreview: vi.fn()
}))
vi.mock('@/runtime/files/grants/runtime-terminal-artifact-grant', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  acquireTerminalArtifactGrant: mocks.acquireTerminalArtifactGrant
}))
vi.mock('@/runtime/files/grants/runtime-terminal-artifact-read', () => ({
  readRuntimeTerminalArtifactContent: mocks.readRuntimeTerminalArtifactContent
}))
vi.mock('@/runtime/files/reads/runtime-file-read-client', () => ({
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))

import { readNativeChatVideoSrc } from './native-chat-video-src'

const RECORDING = '/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4'
const context = {
  target: { kind: 'environment' as const, environmentId: 'env-1' },
  worktreeId: 'wt-1',
  worktreePath: '/home/dev/repo',
  expectedEnvironmentPairingRevision: 3
}

beforeEach(() => {
  vi.stubGlobal('window', {
    api: { fs: { grantDesktopRecordingPreview: mocks.grantDesktopRecordingPreview } }
  })
  mocks.grantDesktopRecordingPreview.mockResolvedValue({
    mediaUrl: 'orca-media://file/mac-copy',
    mimeType: 'video/mp4'
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('readNativeChatVideoSrc', () => {
  it("streams an environment recording through the host's grant", async () => {
    mocks.acquireTerminalArtifactGrant.mockResolvedValue({
      absolutePath: RECORDING,
      grantId: 'g-1',
      readOnly: true
    })
    mocks.readRuntimeTerminalArtifactContent.mockResolvedValue({
      content: '',
      isBinary: true,
      mediaUrl: 'orca-media://file/env'
    })

    await expect(readNativeChatVideoSrc(context, RECORDING)).resolves.toEqual({
      url: 'orca-media://file/env',
      fromCopy: false
    })
    expect(mocks.readRuntimeTerminalArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: 'g-1', absolutePath: RECORDING, worktreeId: 'wt-1' }),
      { pageOversizedBinary: true }
    )
    expect(mocks.grantDesktopRecordingPreview).not.toHaveBeenCalled()
  })

  it('a recording whose environment is gone plays from the Mac copy', async () => {
    mocks.acquireTerminalArtifactGrant.mockRejectedValue(new Error('runtime unavailable'))

    await expect(readNativeChatVideoSrc(context, RECORDING)).resolves.toEqual({
      url: 'orca-media://file/mac-copy',
      fromCopy: true
    })
    expect(mocks.grantDesktopRecordingPreview).toHaveBeenCalledWith({
      recordingId: '0123456789abcdef'
    })
  })

  it('reads a workspace video by its relative path and has no copy to fall back on', async () => {
    mocks.readRuntimeFileContent.mockRejectedValue(new Error('gone'))

    await expect(readNativeChatVideoSrc(context, '/home/dev/repo/demo.webm')).resolves.toEqual({
      url: null,
      fromCopy: false
    })
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/home/dev/repo/demo.webm',
        relativePath: 'demo.webm',
        pageOversizedBinary: true
      })
    )
    expect(mocks.grantDesktopRecordingPreview).not.toHaveBeenCalled()
  })
})

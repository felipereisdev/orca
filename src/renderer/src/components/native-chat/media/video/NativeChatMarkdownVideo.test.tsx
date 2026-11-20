// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatMarkdown } from '../../markdown/NativeChatMarkdown'
import { NativeChatMarkdownImageOwnerContext } from '../images/native-chat-markdown-image-owner'
import type * as VideoSrc from './native-chat-video-src'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'

const mocks = vi.hoisted(() => {
  const state: {
    readNativeChatVideoSrc: ReturnType<typeof vi.fn>
    readDesktopRecordingCopy: ReturnType<typeof vi.fn>
    real: typeof VideoSrc | null
  } = { readNativeChatVideoSrc: vi.fn(), readDesktopRecordingCopy: vi.fn(), real: null }
  return state
})
vi.mock('./native-chat-video-src', async (importOriginal) => {
  mocks.real = await importOriginal<typeof VideoSrc>()
  return {
    readNativeChatVideoSrc: mocks.readNativeChatVideoSrc,
    readDesktopRecordingCopy: mocks.readDesktopRecordingCopy
  }
})

const RECORDING = '/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4'
const owner = {
  fileLinkContext: {
    worktreeId: 'wt-1',
    worktreePath: '/home/dev/repo',
    runtimeEnvironmentId: 'env-1',
    sourceTabId: 'tab-1'
  },
  runtimeContext: {
    target: { kind: 'environment' as const, environmentId: 'env-1' },
    worktreeId: 'wt-1',
    worktreePath: '/home/dev/repo',
    expectedExecutionHostId: 'local' as const
  },
  isVisible: true,
  sessionId: 'session-1'
}

type Owner = typeof owner | { fileLinkContext: null; runtimeContext: null; isVisible: boolean }

function Transcript({ content, value = owner }: { content: string; value?: Owner }) {
  return (
    <TooltipProvider>
      <NativeChatMarkdownImageOwnerContext.Provider value={value}>
        <NativeChatMarkdown content={content} variant="document" />
      </NativeChatMarkdownImageOwnerContext.Provider>
    </TooltipProvider>
  )
}

function setExperiment(enabled: boolean): void {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp/orca-test'), experimentalEphemeralVms: enabled }
  })
}

beforeEach(() => {
  setExperiment(true)
  vi.stubGlobal('IntersectionObserver', undefined)
  mocks.readNativeChatVideoSrc.mockResolvedValue({
    url: 'orca-media://file/env-copy',
    fromCopy: false
  })
  mocks.readDesktopRecordingCopy.mockResolvedValue('orca-media://file/mac-copy')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('video in a chat message', () => {
  it('a markdown image pointing at an .mp4 renders a video element', async () => {
    const { container } = render(<Transcript content={`![Gravação do teste](<${RECORDING}>)`} />)

    await waitFor(() =>
      expect(container.querySelector('video')).toHaveAttribute('src', 'orca-media://file/env-copy')
    )
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).toHaveAccessibleName('Gravação do teste')
    expect(container.querySelector('img')).toBeNull()
    expect(mocks.readNativeChatVideoSrc).toHaveBeenCalledWith(owner.runtimeContext, RECORDING)
  })

  it('switches to the Mac copy when the environment stream fails to play', async () => {
    const { container } = render(<Transcript content={`![Gravação](<${RECORDING}>)`} />)
    await waitFor(() =>
      expect(container.querySelector('video')).toHaveAttribute('src', 'orca-media://file/env-copy')
    )

    fireEvent.error(container.querySelector('video')!)

    await waitFor(() =>
      expect(container.querySelector('video')).toHaveAttribute('src', 'orca-media://file/mac-copy')
    )
    expect(mocks.readDesktopRecordingCopy).toHaveBeenCalledWith(RECORDING)
  })

  it('a retained transcript with no runtime context still plays from the Mac copy', async () => {
    // The real resolver, down to the Mac-copy grant the main process answers.
    const real = mocks.real!
    mocks.readNativeChatVideoSrc.mockImplementation(real.readNativeChatVideoSrc)
    mocks.readDesktopRecordingCopy.mockImplementation(real.readDesktopRecordingCopy)
    const grantDesktopRecordingPreview = vi.fn(async () => ({
      mediaUrl: 'orca-media://file/mac-copy',
      mimeType: 'video/mp4'
    }))
    vi.stubGlobal('api', { fs: { grantDesktopRecordingPreview } })
    // The workspace is gone: its route no longer resolves, so the owner has no context.
    const { container } = render(
      <Transcript
        value={{ fileLinkContext: null, runtimeContext: null, isVisible: true }}
        content={`![Gravação do teste](<${RECORDING}>)`}
      />
    )

    await waitFor(() =>
      expect(container.querySelector('video')).toHaveAttribute('src', 'orca-media://file/mac-copy')
    )
    expect(grantDesktopRecordingPreview).toHaveBeenCalledWith({ recordingId: '0123456789abcdef' })
  })

  it('renders a video link as before while the environments experiment is off', async () => {
    setExperiment(false)
    const { container } = render(<Transcript content={`![Gravação do teste](<${RECORDING}>)`} />)

    await waitFor(() =>
      expect(container.querySelector('[role="status"], img, button')).not.toBeNull()
    )
    expect(container.querySelector('video')).toBeNull()
    expect(mocks.readNativeChatVideoSrc).not.toHaveBeenCalled()
  })
})

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatMarkdown } from '../../markdown/NativeChatMarkdown'
import { NativeChatMarkdownImageOwnerContext } from '../images/native-chat-markdown-image-owner'

const mocks = vi.hoisted(() => ({
  readNativeChatVideoSrc: vi.fn(),
  readDesktopRecordingCopy: vi.fn()
}))
vi.mock('./native-chat-video-src', () => mocks)

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

function Transcript({ content }: { content: string }) {
  return (
    <TooltipProvider>
      <NativeChatMarkdownImageOwnerContext.Provider value={owner}>
        <NativeChatMarkdown content={content} variant="document" />
      </NativeChatMarkdownImageOwnerContext.Provider>
    </TooltipProvider>
  )
}

beforeEach(() => {
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
})

import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ downloadHostChatVideo: vi.fn() }))
const playback = vi.hoisted(() => ({
  MobileMediaPlayback: (_props: { uri: string; mimeType: string; title: string }) => null
}))
vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }): ReactNode =>
      React.createElement(name, props, children)
  return {
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Platform: { OS: 'ios' },
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
  }
})
vi.mock('lucide-react-native', () => ({ Play: 'Play' }))
vi.mock('./MobileNativeChatMarkdown', () => ({
  MobileNativeChatMarkdown: ({
    renderImage
  }: {
    renderImage: (href: string, alt: string) => ReactNode
  }) => renderImage('/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4', 'Gravação')
}))
vi.mock('../../../../files/media/MobileMediaPlayback', () => playback)
vi.mock('../../visual/mobile-native-chat-video-read', () => mocks)

import { Prose } from './MobileNativeChatProse'
import { MobileNativeChatRowOverlaysContext } from '../message-actions/mobile-native-chat-row-overlays'
import { stubRpcClient } from '../../../../transport/rpc/rpc-client-test-stub'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
})

describe('a video in a chat message', () => {
  it('markdown image block with .mp4 renders the playback component', async () => {
    mocks.downloadHostChatVideo.mockResolvedValue('blob:recording')
    const imageSource = { client: stubRpcClient(), worktreeId: 'wt-1' }
    await act(async () => {
      renderer = create(
        createElement(
          MobileNativeChatRowOverlaysContext.Provider,
          {
            value: {
              openImage: () => {},
              openActions: () => {},
              openRewind: () => {},
              imageSource
            }
          },
          createElement(Prose, {
            block: { type: 'text', text: 'x' },
            text: 'x',
            fontScale: 1
          })
        )
      )
    })
    const root = renderer!.root
    // Nothing downloads until the user asks to play.
    expect(mocks.downloadHostChatVideo).not.toHaveBeenCalled()
    expect(root.findAllByType(playback.MobileMediaPlayback)).toHaveLength(0)

    await act(async () => {
      root.findByProps({ accessibilityRole: 'button' }).props.onPress()
    })

    expect(mocks.downloadHostChatVideo).toHaveBeenCalledWith(
      imageSource,
      '/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4',
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function)
    )
    expect(root.findByType(playback.MobileMediaPlayback).props).toEqual(
      expect.objectContaining({ uri: 'blob:recording', mimeType: 'video/mp4', title: 'Gravação' })
    )
  })
})

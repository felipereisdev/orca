import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    ScrollView: 'ScrollView',
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Animated: { Value: class {}, timing: () => ({ start: vi.fn() }) }
  }
})
vi.mock('lucide-react-native', () => ({
  Play: 'Play',
  Square: 'Square',
  SquareCheck: 'SquareCheck'
}))
vi.mock('../../../../components/mermaid/MermaidDiagram', () => ({
  MermaidDiagram: 'MermaidDiagram'
}))
vi.mock('../../../../components/markdown/math/MobileMarkdownMath', () => ({
  MobileMarkdownMath: 'MobileMarkdownMath'
}))
vi.mock('../../../../components/markdown/blocks/MobileMarkdownCodeBlock', () => ({
  MobileMarkdownCodeBlock: 'MobileMarkdownCodeBlock'
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../../../../files/media/MobileMediaPlayback', () => playback)

import { Prose } from './MobileNativeChatProse'
import { MobileNativeChatRowOverlaysContext } from '../message-actions/mobile-native-chat-row-overlays'
import { stubRpcClient } from '../../../../transport/rpc/rpc-client-test-stub'
import { resetMobileEphemeralVmsSettingCache } from '../../visual/mobile-ephemeral-vms-setting'
import type { RuntimeClientSettings } from '../../../../../../src/main/runtime/client/settings/runtime-client-settings-shape'

// The exact line `orca desktop record stop` prints, for a real recording id.
const RECORDING = '/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4'
const CLI_LINE = `![Gravação do teste](<${RECORDING}>)`
const MiB = 1024 * 1024

// `settings.get` answers `{ settings }` in the host's client shape; the host side pins the value
// (runtime-client-settings-ephemeral-vms.test.ts), the type pins the field's name here.
function hostSettings(experimentalEphemeralVms: boolean): {
  settings: Pick<RuntimeClientSettings, 'experimentalEphemeralVms' | 'compactWorktreeCards'>
} {
  return { settings: { experimentalEphemeralVms, compactWorktreeCards: false } }
}

function hostClient(host: { experiment: boolean; size: number }) {
  const { size } = host
  const sent: { method: string; params: Record<string, unknown> }[] = []
  const results: Record<string, (params: Record<string, unknown>) => unknown> = {
    'settings.get': () => hostSettings(host.experiment),
    'files.resolveTerminalPath': () => ({
      exists: true,
      openTarget: { kind: 'absolute-file', absolutePath: RECORDING, grantId: 'g-1' }
    }),
    'files.statTerminalArtifact': () => ({ size, isDirectory: false, mtime: 1, ctime: 1 }),
    'files.readTerminalArtifactChunk': (params) => {
      const bytes = Buffer.alloc(Math.min(Number(params.length), size - Number(params.offset)), 1)
      return {
        contentBase64: bytes.toString('base64'),
        bytesRead: bytes.byteLength,
        eof: Number(params.offset) + bytes.byteLength >= size
      }
    }
  }
  const client = stubRpcClient({
    sendRequest: (method, params) => {
      const record: Record<string, unknown> = Object(params)
      sent.push({ method, params: record })
      const result = results[method]
      return Promise.resolve(
        result
          ? { id: method, ok: true, result: result(record) }
          : { id: method, ok: false, error: { code: 'method_not_found', message: method } }
      )
    }
  })
  return { client, sent }
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

let renderer: ReactTestRenderer | null = null
async function renderLine(client: ReturnType<typeof hostClient>['client']) {
  await act(async () => {
    renderer = create(
      createElement(
        MobileNativeChatRowOverlaysContext.Provider,
        {
          value: {
            openImage: () => {},
            openActions: () => {},
            openRewind: () => {},
            imageSource: { client, worktreeId: 'wt-1' }
          }
        },
        createElement(Prose, {
          block: { type: 'text', text: CLI_LINE },
          text: CLI_LINE,
          fontScale: 1
        })
      )
    )
  })
  return renderer!.root
}
const playButtons = (root: ReactTestInstance) =>
  root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.type === 'string')

beforeEach(() => resetMobileEphemeralVmsSettingCache())
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('a desktop recording in a chat message', () => {
  it('markdown image block with .mp4 renders the playback component', async () => {
    const { client, sent } = hostClient({ experiment: true, size: 1000 })
    const root = await renderLine(client)
    // Nothing downloads until the user asks to play.
    expect(sent.some((call) => call.method.startsWith('files.'))).toBe(false)
    expect(root.findAllByType(playback.MobileMediaPlayback)).toHaveLength(0)

    await act(async () => playButtons(root)[0]?.props.onPress())

    expect(root.findByType(playback.MobileMediaPlayback).props).toEqual(
      expect.objectContaining({
        uri: expect.stringMatching(/^blob:/),
        mimeType: 'video/mp4',
        title: 'Gravação do teste'
      })
    )
  })

  it('shows a message instead of downloading a recording over the phone cap', async () => {
    const { client, sent } = hostClient({ experiment: true, size: 300 * MiB })
    const root = await renderLine(client)

    await act(async () => playButtons(root)[0]?.props.onPress())

    expect(textOf(root)).toContain(
      'Recording too large to play on the phone — open it on the computer'
    )
    expect(sent.some((call) => call.method === 'files.readTerminalArtifactChunk')).toBe(false)
    expect(sent.some((call) => call.method.startsWith('desktop.'))).toBe(false)
    expect(root.findAllByType(playback.MobileMediaPlayback)).toHaveLength(0)
  })

  it('leaves the line a link while the environments experiment is off', async () => {
    const { client, sent } = hostClient({ experiment: false, size: 1000 })
    const root = await renderLine(client)

    expect(playButtons(root)).toHaveLength(0)
    expect(root.findAllByType(playback.MobileMediaPlayback)).toHaveLength(0)
    expect(textOf(root)).toContain('Gravação do teste')
    expect(sent.some((call) => call.method.startsWith('files.'))).toBe(false)
  })

  it('an open transcript follows the experiment being turned off within the refresh window', async () => {
    vi.useFakeTimers()
    try {
      const host = { experiment: true, size: 1000 }
      const { client } = hostClient(host)
      const root = await renderLine(client)
      expect(playButtons(root)).not.toHaveLength(0)

      host.experiment = false
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })

      expect(playButtons(root)).toHaveLength(0)
      expect(textOf(root)).toContain('Gravação do teste')
    } finally {
      vi.useRealTimers()
    }
  })
})

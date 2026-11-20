import { describe, expect, it } from 'vitest'
import { desktopRecordingIdFromPath, isNativeChatVideoPath } from './native-chat-video-path'

describe('isNativeChatVideoPath', () => {
  it('isNativeChatVideoPath accepts mp4/webm/mov case-insensitively', () => {
    expect(
      isNativeChatVideoPath('/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4')
    ).toBe(true)
    expect(isNativeChatVideoPath('clips/demo.WEBM')).toBe(true)
    expect(isNativeChatVideoPath('C:\\clips\\demo.Mov')).toBe(true)
    expect(isNativeChatVideoPath('/tmp/shot.png')).toBe(false)
    expect(isNativeChatVideoPath('/tmp/song.mp3')).toBe(false)
    expect(isNativeChatVideoPath('/tmp/.mp4')).toBe(false)
  })
})

describe('desktopRecordingIdFromPath', () => {
  it('reads the id only from a recording file name', () => {
    expect(
      desktopRecordingIdFromPath('/home/dev/.orca/desktop-recordings/rec-0123456789abcdef.mp4')
    ).toBe('0123456789abcdef')
    expect(desktopRecordingIdFromPath('/tmp/rec-0123456789ABCDEF.mp4')).toBeNull()
    expect(desktopRecordingIdFromPath('/tmp/rec-0123.mp4')).toBeNull()
    expect(desktopRecordingIdFromPath('/tmp/demo.mp4')).toBeNull()
  })
})

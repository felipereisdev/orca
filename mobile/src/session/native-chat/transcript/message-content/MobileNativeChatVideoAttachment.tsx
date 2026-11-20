import { useContext, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Play } from 'lucide-react-native'
import { MobileMediaPlayback } from '../../../../files/media/MobileMediaPlayback'
import { mobileFileMediaMime } from '../../../../files/media/mobile-file-media'
import { createMobileMediaSink } from '../../../../files/media/mobile-media-preview-cache'
import {
  MobileMediaTooLargeError,
  type MobileMediaSink
} from '../../../../files/media/mobile-file-media-download'
import { formatPreviewByteLength } from '../../../../files/preview/mobile-file-preview-response'
import { MobileNativeChatRowOverlaysContext } from '../message-actions/mobile-native-chat-row-overlays'
import { downloadHostChatVideo } from '../../visual/mobile-native-chat-video-read'
import { styles } from '../messages/mobile-native-chat-message-styles'
import { colors, pressedStyle } from '../../../../theme/mobile-theme'
import { useMobileColorScheme } from '../../../../theme/use-mobile-color-scheme'
import { useMobileTranslation } from '../../../../i18n/use-mobile-translation'

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; bytes: number; total: number }
  | { kind: 'ready'; uri: string }
  | { kind: 'failed' }
  | { kind: 'tooLarge' }

/** A host video the agent named as an image; it downloads only once the user asks to play it. */
export function MobileNativeChatVideoAttachment({
  path,
  alt,
  onLongPress
}: {
  path: string
  alt?: string
  onLongPress?: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const { imageSource } = useContext(MobileNativeChatRowOverlaysContext)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const mimeType = mobileFileMediaMime(path) ?? 'video/mp4'
  const label = alt?.trim() || t('chat.nativeChatProse.video', 'Video')
  useEffect(() => {
    if (attempt === 0 || !imageSource) {
      return
    }
    const controller = new AbortController()
    let sink: MobileMediaSink | null = null
    setState({ kind: 'loading', bytes: 0, total: 0 })
    void downloadHostChatVideo(
      imageSource,
      path,
      () => {
        sink?.dispose()
        sink = createMobileMediaSink(path, mimeType)
        return sink
      },
      controller.signal,
      (bytes, total) => setState({ kind: 'loading', bytes, total })
    ).then(
      (uri) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'ready', uri })
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: error instanceof MobileMediaTooLargeError ? 'tooLarge' : 'failed' })
        }
      }
    )
    return () => {
      controller.abort()
      sink?.dispose()
    }
  }, [attempt, imageSource, path, mimeType])
  if (state.kind === 'ready') {
    return (
      <View style={styles.videoFrame}>
        <MobileMediaPlayback key={state.uri} uri={state.uri} mimeType={mimeType} title={label} />
      </View>
    )
  }
  if (state.kind === 'tooLarge') {
    return (
      <View style={styles.videoThumb} accessibilityLabel={label}>
        <Text style={styles.videoThumbText}>
          {t(
            'chat.nativeChatProse.videoTooLarge',
            'Recording too large to play on the phone — open it on the computer'
          )}
        </Text>
      </View>
    )
  }
  if (state.kind === 'loading') {
    return (
      <View style={styles.videoThumb} accessibilityLabel={label}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={styles.videoThumbText}>
          {state.total
            ? t('files.fileMediaPreview.downloading', 'Downloading {{bytes}} of {{total}}', {
                bytes: formatPreviewByteLength(state.bytes),
                total: formatPreviewByteLength(state.total)
              })
            : t('files.fileMediaPreview.loading', 'Loading media...')}
        </Text>
      </View>
    )
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.videoThumb, pressed && pressedStyle]}
      disabled={!imageSource}
      onPress={() => setAttempt((current) => current + 1)}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('chat.nativeChatProse.playVideoHint', 'Downloads and plays the video')}
    >
      <Play color={colors.textSecondary} size={28} />
      <Text style={styles.videoThumbText} numberOfLines={2}>
        {state.kind === 'failed'
          ? t('files.fileMediaPreview.loadFailed', 'Unable to load media')
          : label}
      </Text>
    </Pressable>
  )
}

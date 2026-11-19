import { useContext, useEffect, useRef, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { basename } from '@/lib/path'
import {
  createNativeChatFileHref,
  routeNativeChatHref
} from '../../../../../../shared/native-chat/file-access/native-chat-href-routing'
import {
  NativeChatMarkdownImageOwnerContext,
  nativeChatImageFileLinkContext
} from '../images/native-chat-markdown-image-owner'
import { observeTranscriptVisibility } from '../images/native-chat-image-visibility'
import { useNativeChatMediaHref } from '../images/use-native-chat-media-href'
import { resolveNativeChatFileLink } from '../../links/actions/native-chat-file-link'
import { readDesktopRecordingCopy, readNativeChatVideoSrc } from './native-chat-video-src'
import { desktopRecordingIdFromPath } from '../../../../../../shared/native-chat/media/native-chat-video-path'
import { isRuntimePathAbsolute } from '../../../../../../shared/file-access/cross-platform-path'

type VideoState = { path: string; url: string | null; fromCopy: boolean }

/** A video the agent named as a markdown image, played inline; nothing loads until it nears the viewport. */
export function NativeChatMarkdownVideo({
  src,
  alt
}: {
  src: string
  alt?: string
}): React.JSX.Element {
  const t = useTranslate()
  const owner = useContext(NativeChatMarkdownImageOwnerContext)
  const runtimeContext = owner?.runtimeContext ?? null
  const fileLinkContext = nativeChatImageFileLinkContext(owner)
  const route = routeNativeChatHref(src)
  const visible = owner?.isVisible ?? true
  const [near, setNear] = useState(false)
  const frameRef = useRef<HTMLSpanElement>(null)
  const active = visible && near
  const media = useNativeChatMediaHref({
    href: route.kind === 'file' ? createNativeChatFileHref(route.pathText, 'literal') : undefined,
    runtimeContext,
    tabId: fileLinkContext?.sourceTabId,
    sessionId: owner?.sessionId,
    active,
    retryKey: 0
  })
  const resolvedPath = resolveNativeChatFileLink(media.href, fileLinkContext)?.absolutePath
  // A recording names itself by id: its Mac copy plays even when the workspace route is gone.
  const recordingPath =
    route.kind === 'file' &&
    isRuntimePathAbsolute(route.pathText) &&
    desktopRecordingIdFromPath(route.pathText)
      ? route.pathText
      : undefined
  const absolutePath = resolvedPath ?? recordingPath
  const hostContext = resolvedPath ? runtimeContext : null
  const [video, setVideo] = useState<VideoState>()
  useEffect(() => {
    const element = frameRef.current
    return element ? observeTranscriptVisibility(element, setNear) : undefined
  }, [])
  useEffect(() => {
    if (!absolutePath || !active) {
      return
    }
    let cancelled = false
    void readNativeChatVideoSrc(hostContext, absolutePath).then((result) => {
      if (!cancelled) {
        setVideo({ path: absolutePath, ...result })
      }
    })
    return () => {
      cancelled = true
    }
  }, [absolutePath, active, hostContext])
  const current = video && video.path === absolutePath ? video : undefined
  const title =
    alt?.trim() ||
    (absolutePath ? basename(absolutePath) : '') ||
    t('auto.components.sidebar.MarkdownImageLightbox.image', 'Image')
  // A stream minted before its environment went away fails only once played.
  const onError = (): void => {
    if (!current || current.fromCopy) {
      setVideo(current ? { ...current, url: null } : undefined)
      return
    }
    const failedPath = current.path
    void readDesktopRecordingCopy(failedPath).then((url) =>
      setVideo((latest) =>
        latest?.path === failedPath ? { path: failedPath, url, fromCopy: true } : latest
      )
    )
  }
  return (
    // Spans: markdown places images inside paragraphs.
    <span ref={frameRef} className="block max-w-full">
      {current?.url ? (
        <video
          key={current.url}
          src={current.url}
          controls
          preload="metadata"
          aria-label={title}
          className="max-h-96 max-w-full rounded-md bg-black outline outline-1 outline-border/70"
          onError={onError}
        />
      ) : current ? (
        <span role="status" className="text-sm text-muted-foreground">
          {t('components.native-chat.composer.imageUnavailable', 'Preview unavailable')}
        </span>
      ) : (
        <span
          role="img"
          aria-label={title}
          className="block aspect-video w-80 max-w-full rounded-md bg-muted outline outline-1 outline-border/70"
        />
      )}
    </span>
  )
}

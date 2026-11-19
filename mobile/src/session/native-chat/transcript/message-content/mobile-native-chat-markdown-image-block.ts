import type { NativeChatImageRefBlock } from '../../../../../../src/shared/native-chat/native-chat-types'
import { routeNativeChatHref } from '../../../../../../src/shared/native-chat/file-access/native-chat-href-routing'
import { isRuntimePathAbsolute } from '../../../../../../src/shared/file-access/cross-platform-path'
import { isRasterImagePath } from '../../../../../../src/shared/file-preview/file-preview-kind'
import { isKnownRasterImageMimeType } from '../../../../../../src/shared/file-preview/raster-image-preview-limits'
import { isSvgFilePath } from '../../../../../../src/shared/file-preview/svg-document'
import { isNativeChatVideoPath } from '../../../../../../src/shared/native-chat/media/native-chat-video-path'

/** Raster https, data and absolute-path images draw on the phone (paths through the chat's host), and
 *  absolute-path videos play there; anything else stays a link.
 *  The shell's CSP refuses plain http, and React Native's Image cannot draw SVG. */
export function mobileNativeChatMarkdownImageBlock(
  href: string,
  alt: string
): NativeChatImageRefBlock | null {
  const label = alt.trim() ? { alt } : {}
  const source = href.trim()
  if (/^data:/i.test(source)) {
    return isKnownRasterImageMimeType(source.slice(5).split(/[;,]/, 1)[0])
      ? { type: 'image-ref', url: source, ...label }
      : null
  }
  const route = routeNativeChatHref(source)
  if (route.kind === 'web') {
    return /^https:/i.test(route.url) && !isSvgFilePath(route.url.split(/[?#]/, 1)[0] ?? '')
      ? { type: 'image-ref', url: route.url, ...label }
      : null
  }
  return route.kind === 'file' &&
    isRuntimePathAbsolute(route.pathText) &&
    (isRasterImagePath(route.pathText) || isNativeChatVideoPath(route.pathText))
    ? { type: 'image-ref', path: route.pathText, ...label }
    : null
}

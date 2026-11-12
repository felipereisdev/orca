import type { JiraAgentAttachment } from '../../shared/jira/jira-agent-access'
import { collectAdfMediaAttrs, type AdfToMarkdownOptions } from './adf-markdown'

export function jiraAgentMarkdownOptions(
  body: unknown,
  html: string,
  attachments: JiraAgentAttachment[],
  siteUrl: string
): AdfToMarkdownOptions {
  const known = new Map(attachments.map((item) => [item.id, item]))
  const bindings = new Map<string, string>()
  const conflicted = new Set<string>()
  const bind = (mediaId: string, attachmentId: string): void => {
    if (bindings.has(mediaId) && bindings.get(mediaId) !== attachmentId) {
      conflicted.add(mediaId)
    }
    bindings.set(mediaId, attachmentId)
  }
  const images: { mediaId?: string; attachmentId?: string }[] = []
  const markup = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const tags = markup.matchAll(/<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)
  for (const match of tags) {
    if (images.length >= 1001) {
      break
    }
    const attributes = new Map<string, string>()
    let duplicate = false
    for (const attr of match[0]
      .slice(4, -1)
      .matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = attr[1].toLowerCase()
      if (attributes.has(name)) {
        duplicate = true
      }
      attributes.set(name, (attr[2] ?? attr[3] ?? attr[4] ?? '').replace(/&amp;/gi, '&'))
    }
    let attachmentId: string | undefined
    const mediaId = attributes.get('data-media-id')
    try {
      const source = attributes.get('src')
      const url = source ? new URL(source, siteUrl) : undefined
      const local =
        !url || (url.origin === new URL(siteUrl).origin && !url.username && !url.password)
      const routeId = url?.pathname.match(
        /\/(?:rest\/api\/\d+\/attachment\/(?:content|thumbnail)|secure\/(?:attachment|thumbnail))\/(\d+)(?:\/|$)/i
      )?.[1]
      const attributeId = attributes.get('data-attachment-id')
      const id = attributeId || routeId
      if (
        !duplicate &&
        local &&
        id &&
        known.has(id) &&
        (!attributeId || !routeId || attributeId === routeId)
      ) {
        attachmentId = id
      }
    } catch {
      /* Malformed image sources cannot prove attachment identity. */
    }
    images.push({ mediaId, attachmentId })
    if (mediaId && attachmentId) {
      bind(mediaId, attachmentId)
    }
  }
  const media = collectAdfMediaAttrs(body)
  if (
    media.length === images.length &&
    media.length <= 1000 &&
    media.every((item) => item.id && !item.url && item.type !== 'external') &&
    images.every((item) => item.attachmentId)
  ) {
    const positional = new Map<string, string>()
    let consistent = true
    for (let index = 0; index < media.length; index++) {
      const mediaId = media[index].id
      const image = images[index]
      const attachmentId = image.attachmentId
      if (!mediaId || !attachmentId) {
        consistent = false
        break
      }
      if (
        (image.mediaId && image.mediaId !== mediaId) ||
        (known.has(mediaId) && mediaId !== attachmentId) ||
        (positional.has(mediaId) && positional.get(mediaId) !== attachmentId) ||
        (bindings.has(mediaId) && bindings.get(mediaId) !== attachmentId) ||
        conflicted.has(mediaId)
      ) {
        consistent = false
      }
      positional.set(mediaId, attachmentId)
    }
    if (consistent) {
      for (const [mediaId, attachmentId] of positional) {
        bind(mediaId, attachmentId)
      }
    }
  }
  return {
    resolveMedia: (attrs) => {
      const id = attrs.id
      const attachment =
        !attrs.url && id
          ? (known.get(id) ?? (!conflicted.has(id) ? known.get(bindings.get(id) ?? '') : undefined))
          : undefined
      return attachment
        ? `[Attachment: ${attachment.filename} (id: ${attachment.id})]`
        : `[Media: ${id ?? attrs.alt ?? 'unresolved'}]`
    }
  }
}

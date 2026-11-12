import { createHash } from 'node:crypto'
import {
  JIRA_AGENT_ATTACHMENT_CHUNK_BYTES,
  JIRA_AGENT_ATTACHMENT_MAX_BYTES,
  type JiraAgentAttachment,
  type JiraAttachmentReadParams,
  type JiraAttachmentReadResult
} from '../../shared/jira/jira-agent-access'
import { readFetchResponseBytesWithinLimit } from '../../shared/fetch-response-body'
import { apiBaseUrl, jiraFetch } from './authenticated-request'
import { attachmentContentUrl } from './attachments/content-url'
import { asRecord, asString } from './jira-record-pages'
import { jiraAgentAttachments } from './jira-agent-context'
import {
  jiraAgentClient,
  jiraAgentError,
  jiraAgentIssuePath,
  jiraAgentRequest,
  sanitizeJiraAgentError
} from './jira-agent-request'

let cached: { key: string; bytes: Uint8Array; expires: number } | undefined
let expiryTimer: ReturnType<typeof setTimeout> | undefined
function clearAttachmentCache(): void {
  cached = undefined
  clearTimeout(expiryTimer)
}
function attachmentChunk(
  metadata: JiraAgentAttachment,
  bytes: Uint8Array,
  offset: number
): JiraAttachmentReadResult {
  if (offset > bytes.byteLength) {
    throw jiraAgentError('jira_invalid_offset', 'Attachment offset exceeds its size.')
  }
  const end = Math.min(offset + JIRA_AGENT_ATTACHMENT_CHUNK_BYTES, bytes.byteLength)
  const result = {
    ...metadata,
    content: Buffer.from(bytes.subarray(offset, end)).toString('base64'),
    offset,
    nextOffset: end < bytes.byteLength ? end : null
  }
  if (result.nextOffset === null) {
    clearAttachmentCache()
  }
  return result
}

export async function jiraAttachmentRead(
  params: JiraAttachmentReadParams,
  signal?: AbortSignal
): Promise<JiraAttachmentReadResult> {
  if (
    !Number.isSafeInteger(params.offset) ||
    params.offset < 0 ||
    params.offset > JIRA_AGENT_ATTACHMENT_MAX_BYTES
  ) {
    throw jiraAgentError(
      'jira_invalid_offset',
      'Attachment offset must be a nonnegative integer within the file limit.'
    )
  }
  const client = jiraAgentClient(params.siteId)
  const raw = await jiraAgentRequest(
    client,
    jiraAgentIssuePath(client, params.key, ['attachment']),
    signal
  )
  const field = asRecord(raw.fields).attachment
  const metadata = jiraAgentAttachments(field).find((item) => item.id === params.id)
  if (!metadata) {
    throw jiraAgentError(
      'jira_issue_not_found',
      'Attachment does not belong to this issue or is inaccessible.'
    )
  }
  if (
    metadata.id.length > 128 ||
    metadata.filename.length > 1024 ||
    metadata.mimeType.length > 200
  ) {
    throw jiraAgentError('jira_read_failed', 'Jira returned invalid attachment metadata.')
  }
  if (
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0 ||
    metadata.size > JIRA_AGENT_ATTACHMENT_MAX_BYTES
  ) {
    throw jiraAgentError('jira_attachment_too_large', 'Attachments must be at most 20 MiB.')
  }
  const attachment = (Array.isArray(field) ? field : [])
    .map(asRecord)
    .find((item) => asString(item.id) === params.id)
  const cacheKey = createHash('sha256')
    .update(
      JSON.stringify([
        params.siteId,
        params.key,
        params.id,
        client.authorization,
        metadata,
        attachment?.content
      ])
    )
    .digest('hex')
  if (params.offset > 0 && cached?.key === cacheKey && cached.expires > Date.now()) {
    return attachmentChunk(metadata, cached.bytes, params.offset)
  }
  clearAttachmentCache()
  try {
    let url = attachmentContentUrl(client.site, {
      ...metadata,
      contentUrl: asString(attachment?.content) || undefined
    })
    if (!url) {
      throw new Error('Unavailable')
    }
    const base = new URL(apiBaseUrl(client.site))
    const site = new URL(client.site.siteUrl)
    if (
      base.href !== site.href &&
      url.origin === site.origin &&
      url.pathname.startsWith('/rest/')
    ) {
      url = new URL(`${apiBaseUrl(client.site)}${url.pathname}${url.search}`)
    }
    for (let redirects = 0; redirects <= 5; redirects++) {
      const allowed =
        base.origin === site.origin
          ? url.origin === site.origin
          : url.href.startsWith(`${apiBaseUrl(client.site)}/`)
      if (!allowed || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) {
        throw new Error('Unavailable')
      }
      const response = await jiraFetch(url.href, {
        redirect: 'manual',
        signal,
        headers: { Authorization: client.authorization, Accept: '*/*', 'User-Agent': 'Orca' }
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) {
          throw new Error('Unavailable')
        }
        url = new URL(location, url)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw { status: response.status }
      }
      const bytes = await readFetchResponseBytesWithinLimit(
        response,
        JIRA_AGENT_ATTACHMENT_MAX_BYTES
      )
      if (bytes.byteLength !== metadata.size) {
        throw jiraAgentError(
          'jira_attachment_size_mismatch',
          'Attachment size changed. Reload the issue and try again.'
        )
      }
      cached = { key: cacheKey, bytes, expires: Date.now() + 60_000 }
      expiryTimer = setTimeout(clearAttachmentCache, 60_000)
      expiryTimer.unref()
      return attachmentChunk(metadata, bytes, params.offset)
    }
    throw new Error('Unavailable')
  } catch (error) {
    if (
      error instanceof Error &&
      /^jira_(attachment_size_mismatch|invalid_offset):/.test(error.message)
    ) {
      throw error
    }
    throw sanitizeJiraAgentError(error)
  }
}

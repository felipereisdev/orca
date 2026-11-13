import { mkdir, open, unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  JIRA_AGENT_ATTACHMENT_CHUNK_BYTES,
  JIRA_AGENT_ATTACHMENT_MAX_BYTES,
  type JiraAttachmentReadResult,
  type JiraIssueContextResult
} from '../../shared/jira/jira-agent-access'
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { callJiraRead } from './jira-read-call'
import { resolveJiraTarget } from './jira-target'
import { RuntimeClientError } from '../runtime/types'

function transferFailure(): RuntimeClientError {
  return new RuntimeClientError(
    'jira_attachment_transfer_failed',
    'The attachment transfer was inconsistent. Reload the issue and retry.'
  )
}

export async function saveJiraAttachment(
  directory: string,
  first: JiraAttachmentReadResult,
  readNext: (offset: number) => Promise<JiraAttachmentReadResult>
): Promise<{ id: string; filename: string; path: string; size: number }> {
  if (
    !/^[A-Za-z0-9_-]+$/.test(first.id) ||
    !Number.isSafeInteger(first.size) ||
    first.size < 0 ||
    first.size > JIRA_AGENT_ATTACHMENT_MAX_BYTES
  ) {
    throw transferFailure()
  }
  const name = basename(first.filename.replaceAll('\\', '/'))
    .replace(/[<>:"/\\|?*\p{C}]/gu, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 160)
  const path = resolve(directory, `${first.id}-${name || 'attachment'}`)
  let handle
  try {
    handle = await open(path, 'wx', 0o600)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new RuntimeClientError(
        'jira_attachment_exists',
        'An output file already exists. Choose a different --out directory; files are never overwritten.'
      )
    }
    throw new RuntimeClientError(
      'jira_attachment_write_failed',
      'Could not create the output file. Check --out and directory permissions.'
    )
  }
  try {
    let chunk = first
    let offset = 0
    while (true) {
      if (
        chunk.id !== first.id ||
        chunk.size !== first.size ||
        chunk.filename !== first.filename ||
        chunk.offset !== offset ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.content) ||
        chunk.content.length > Math.ceil(JIRA_AGENT_ATTACHMENT_CHUNK_BYTES / 3) * 4
      ) {
        throw transferFailure()
      }
      const bytes = Buffer.from(chunk.content, 'base64')
      if (bytes.length > JIRA_AGENT_ATTACHMENT_CHUNK_BYTES || offset + bytes.length > first.size) {
        throw transferFailure()
      }
      await handle.writeFile(bytes)
      offset += bytes.length
      if (chunk.nextOffset === null) {
        if (offset !== first.size) {
          throw transferFailure()
        }
        break
      }
      if (!bytes.length || chunk.nextOffset !== offset || offset >= first.size) {
        throw transferFailure()
      }
      chunk = await readNext(offset)
    }
    await handle.close()
    return { id: first.id, filename: first.filename, path, size: first.size }
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(path).catch(() => {})
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'jira_attachment_write_failed',
      'Could not finish writing the attachment. Check disk space and --out permissions, then retry.'
    )
  }
}

export const downloadJiraAttachments: CommandHandler = async (context) => {
  const id = getOptionalStringFlag(context.flags, 'id')
  const all = context.flags.get('all') === true
  if (id && all) {
    throw new RuntimeClientError('invalid_argument', 'Pass --id or --all, not both.')
  }
  const target = await resolveJiraTarget(context, getRequiredStringFlag(context.flags, 'key'))
  const response = await callJiraRead<JiraIssueContextResult>(context, 'jira.issueContext', {
    key: target.key,
    siteId: target.siteId,
    attachments: true
  })
  const attachments = response.result.attachments ?? []
  if (all && response.result.truncated && attachments.length >= 100) {
    throw new RuntimeClientError(
      'jira_attachment_limit',
      'Attachment listing was truncated. Select a specific --id instead of --all.'
    )
  }
  if (!id && !all && attachments.length !== 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Select --id <attachmentId> or --all. Use jira issue --attachments to list attachments.'
    )
  }
  const ids = id ? [id] : attachments.map((file) => file.id)
  const directory = resolve(context.cwd, getOptionalStringFlag(context.flags, 'out') ?? '.')
  await mkdir(directory, { recursive: true })
  const files: Awaited<ReturnType<typeof saveJiraAttachment>>[] = []
  let total = 0
  for (const attachmentId of ids) {
    const read = async (offset: number) =>
      (
        await callJiraRead<JiraAttachmentReadResult>(context, 'jira.attachmentRead', {
          key: target.key,
          siteId: target.siteId,
          id: attachmentId,
          offset
        })
      ).result
    try {
      const first = await read(0)
      total += first.size
      if (total > 100 * 1024 * 1024) {
        throw new RuntimeClientError(
          'jira_attachment_limit',
          'Downloads exceed 100 MiB. Select individual attachments with --id.'
        )
      }
      files.push(await saveJiraAttachment(directory, first, read))
    } catch (error) {
      if (error instanceof RuntimeClientError) {
        throw new RuntimeClientError(error.code, error.message, { files })
      }
      throw new RuntimeClientError(
        'jira_attachment_transfer_failed',
        'Could not download attachments. Check the Jira connection and --out directory, then retry.',
        { files }
      )
    }
  }
  printResult(
    { ...response, result: { key: target.key, siteId: target.siteId, files } },
    context.json,
    (result) => result.files.map((file) => file.path).join('\n') || 'No attachments.'
  )
}

import type { Repo } from '../../shared/repo-types'
import {
  glabExecFileAsync as defaultGlabExec,
  type GlabExecOptions
} from '../git/command-runner/hosted-cli/glab-exec-file'
import { getClients as getJiraClients } from '../jira/client'
import { apiBasePath, jiraRequest } from '../jira/authenticated-request'
import { attachmentContentUrl } from '../jira/attachments/content-url'
import { readAttachmentImageBytes } from '../jira/attachments/image-bytes'
import { parseImageAttachmentMetas, type AttachmentMeta } from '../jira/attachments/meta'
import type { JiraClientForSite } from '../jira/authenticated-request'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import {
  readTaskBoardGitHubIssue,
  readTaskBoardGitLabIssue,
  type TaskBoardCommentDeps
} from './task-board-comments'
import type { TaskStartContextDeps, TaskStartFetchDeps } from './task-start-context'
import type { TaskStartSshAccess } from './task-start-context-images'

type IssueDeps = {
  jiraIssue(key: string, siteId: string | null): Promise<{ description?: string } | null>
  linearIssue(
    id: string,
    workspaceId: string | null
  ): Promise<{ description?: string; descriptionImageUrls?: Record<string, string> } | null>
}

type JiraAttachment = { client: JiraClientForSite; meta: AttachmentMeta }

const MAX_JIRA_ATTACHMENTS = 200

/** Download handles for one service's Jira images; entries drop on use or past the cap. */
export type JiraAttachmentRegistry = {
  register(url: string, attachment: JiraAttachment): void
  take(url: string): JiraAttachment | undefined
}

export function createJiraAttachmentRegistry(): JiraAttachmentRegistry {
  const byUrl = new Map<string, JiraAttachment>()
  return {
    register(url, attachment) {
      byUrl.set(url, attachment)
      while (byUrl.size > MAX_JIRA_ATTACHMENTS) {
        const oldest = byUrl.keys().next().value
        if (oldest === undefined) {
          break
        }
        byUrl.delete(oldest)
      }
    },
    take(url) {
      const found = byUrl.get(url)
      byUrl.delete(url)
      return found
    }
  }
}

/** The issue's image attachments (never the base64 media in descriptions) registered for download. */
async function readJiraImageUrls(
  registry: JiraAttachmentRegistry,
  key: string,
  siteId: string | null
): Promise<string[]> {
  const [client] = getJiraClients(siteId)
  if (!client) {
    throw new Error('Jira site unavailable')
  }
  const issue = await jiraRequest<{ fields?: { attachment?: unknown } }>(
    client,
    `${apiBasePath(client.site)}/issue/${encodeURIComponent(key)}?fields=attachment`
  )
  const urls: string[] = []
  for (const meta of parseImageAttachmentMetas(issue.fields?.attachment)) {
    const url = attachmentContentUrl(client.site, meta)?.toString()
    if (url) {
      registry.register(url, { client, meta })
      urls.push(url)
    }
  }
  return urls
}

/** Real readers for the card context, reusing the board's own provider deps. */
export function createTaskStartContextDeps(
  deps: TaskBoardCommentDeps & IssueDeps,
  registry: JiraAttachmentRegistry
): TaskStartContextDeps {
  return {
    github: async (ref) => (await readTaskBoardGitHubIssue(ref, deps)).details,
    gitlab: async (ref) => (await readTaskBoardGitLabIssue(ref, deps)).details,
    jira: async (ref) => {
      const [issue, comments, attachmentUrls] = await Promise.all([
        deps.jiraIssue(ref.key, ref.siteId),
        deps.jiraComments(ref.key, ref.siteId),
        readJiraImageUrls(registry, ref.key, ref.siteId).catch((error: unknown) => {
          console.warn(
            '[task-start] Jira attachment list unavailable; continuing without images',
            error
          )
          return []
        })
      ])
      if (!issue) {
        throw new Error(`Jira issue ${ref.key} could not be read`)
      }
      return { description: issue.description ?? '', comments, attachmentUrls }
    },
    linear: async (ref) => {
      const [issue, comments] = await Promise.all([
        deps.linearIssue(ref.id, ref.workspaceId),
        deps.linearComments(ref.id, ref.workspaceId)
      ])
      if (!issue) {
        throw new Error(`Linear issue ${ref.id} could not be read`)
      }
      return {
        description: issue.description ?? '',
        descriptionImageUrls: issue.descriptionImageUrls,
        comments
      }
    }
  }
}

/** Narrowed so a test double can answer raw bytes, as `encoding: 'buffer'` does. */
type GlabExec = (args: string[], options: GlabExecOptions) => Promise<{ stdout: unknown }>

export function createTaskStartFetchDeps(
  repo: (repoId: string) => Repo | null,
  registry: JiraAttachmentRegistry,
  glabExec: GlabExec = defaultGlabExec
): TaskStartFetchDeps {
  return {
    fetchUrl: async (_card, url) => {
      const attachment = registry.take(url)
      if (attachment) {
        const image = await readAttachmentImageBytes(attachment.client, attachment.meta)
        if (!image) {
          throw new Error('Jira image unavailable')
        }
        return Buffer.from(image.data)
      }
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Image download failed: ${response.status}`)
      }
      return Buffer.from(await response.arrayBuffer())
    },
    gitlabUpload: async (card, secret, fileName) => {
      if (card.ref.provider !== 'gitlab') {
        throw new Error('not a GitLab card')
      }
      const target = repo(card.ref.repoId)
      const path = card.ref.projectRef?.path ?? new URL(card.url).pathname.split('/-/')[0].slice(1)
      const { stdout } = await glabExec(
        [
          'api',
          `projects/${encodeURIComponent(path)}/uploads/${secret}/${encodeURIComponent(fileName)}`
        ],
        { cwd: target?.path, encoding: 'buffer' }
      )
      // Only encoding 'buffer' keeps raw bytes; any text encoding would mangle bytes >= 0x80.
      const body = stdout
      if (!Buffer.isBuffer(body)) {
        throw new Error('glab returned text for a binary download')
      }
      return body
    }
  }
}

export function createTaskStartSshAccess(): TaskStartSshAccess {
  const connection = (id: string) => {
    const found = getSshConnectionManager()?.getConnection(id)
    if (!found) {
      throw new Error('SSH connection unavailable')
    }
    return found
  }
  return {
    exec: (id, command) => execCommand(connection(id), command),
    writeBuffer: (id, remotePath, contents) => connection(id).writeBuffer(remotePath, contents)
  }
}

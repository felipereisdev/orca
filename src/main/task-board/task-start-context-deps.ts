import type { Repo } from '../../shared/repo-types'
import type { JiraSiteSelection } from '../../shared/jira/jira-types'
import { glabExecFileAsync } from '../git/command-runner/hosted-cli/glab-exec-file'
import { getClients as getJiraClients } from '../jira/client'
import { jiraRequestBinary } from '../jira/authenticated-request'
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

/** Real readers for the card context, reusing the board's own provider deps. */
export function createTaskStartContextDeps(
  deps: TaskBoardCommentDeps & IssueDeps
): TaskStartContextDeps {
  return {
    github: async (ref) => (await readTaskBoardGitHubIssue(ref, deps)).details,
    gitlab: async (ref) => (await readTaskBoardGitLabIssue(ref, deps)).details,
    jira: async (ref) => {
      const [issue, comments] = await Promise.all([
        deps.jiraIssue(ref.key, ref.siteId),
        deps.jiraComments(ref.key, ref.siteId)
      ])
      if (!issue) {
        throw new Error(`Jira issue ${ref.key} could not be read`)
      }
      return { description: issue.description ?? '', comments }
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

export function createTaskStartFetchDeps(
  repo: (repoId: string) => Repo | null
): TaskStartFetchDeps {
  return {
    fetchUrl: async (card, url) => {
      if (card.ref.provider === 'jira') {
        const site: JiraSiteSelection | null = card.ref.siteId
        const [client] = getJiraClients(site)
        if (client && url.startsWith(client.site.siteUrl)) {
          return Buffer.from((await jiraRequestBinary(client, url)).data)
        }
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
      const { stdout } = await glabExecFileAsync(
        [
          'api',
          `projects/${encodeURIComponent(path)}/uploads/${secret}/${encodeURIComponent(fileName)}`
        ],
        { cwd: target?.path, encoding: 'latin1' }
      )
      // latin1 maps every byte to one char, so the binary body round-trips intact.
      return Buffer.from(stdout, 'latin1')
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
    exec: async (id, command) => {
      const channel = await connection(id).exec(command)
      return new Promise<string>((resolve, reject) => {
        let out = ''
        channel.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
        channel.on('error', reject)
        channel.on('close', (code: number | null) =>
          code ? reject(new Error(`remote command exited ${code}`)) : resolve(out)
        )
      })
    },
    writeBuffer: (id, remotePath, contents) => connection(id).writeBuffer(remotePath, contents)
  }
}

import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { TaskBoardCardRef } from '../../shared/task-board/task-board-wire-types'
import type { WorkspaceAttachment } from '../../shared/worktree/types'
import {
  findTaskBoardWorkspace,
  taskBoardWorkspaceCandidates,
  type TaskBoardWorkspaceCandidate
} from './task-board-workspace-match'

function jiraLink(siteId: string): WorkspaceAttachment {
  return {
    provider: 'jira',
    type: 'issue',
    number: 0,
    identifier: 'SGP2-1226',
    taskSourceContext: {
      kind: 'task-source',
      provider: 'jira',
      projectId: 'project-1',
      hostId: 'local',
      providerIdentity: { provider: 'jira', siteId }
    }
  }
}

function workspace(id: string, at: string, siteId: string): TaskBoardWorkspaceCandidate {
  return {
    worktreeId: id,
    repoId: 'repo-1',
    path: `/src/${id}`,
    isGitRepo: true,
    branch: id,
    lastActivityAt: Date.parse(at),
    attachments: [jiraLink(siteId)]
  }
}

const siteAIssue: TaskBoardCardRef = { provider: 'jira', siteId: 'site-a', key: 'SGP2-1226' }
const siteACard = {
  ref: siteAIssue,
  displayId: 'SGP2-1226',
  url: 'https://a.atlassian.net/browse/SGP2-1226'
}

describe('findTaskBoardWorkspace', () => {
  it('picks the most recently active workspace among those linked on the card’s own site', () => {
    const found = findTaskBoardWorkspace(siteACard, [
      workspace('a-morning', '2026-11-14T10:00:00Z', 'site-a'),
      workspace('a-noon', '2026-11-14T12:00:00Z', 'site-a'),
      workspace('b-latest', '2026-11-14T13:00:00Z', 'site-b')
    ])

    expect(found?.worktreeId).toBe('a-noon')
  })

  it('does not let a newer link to the same key on another site’s URL win', () => {
    // The Jira link builder stores only the issue URL, with no site id.
    const urlOnly: TaskBoardWorkspaceCandidate = {
      ...workspace('b-by-url', '2026-11-14T13:00:00Z', 'unused'),
      attachments: [
        {
          provider: 'jira',
          type: 'issue',
          number: 0,
          identifier: 'SGP2-1226',
          url: 'https://b.atlassian.net/browse/SGP2-1226'
        }
      ]
    }

    const found = findTaskBoardWorkspace(siteACard, [
      workspace('a-noon', '2026-11-14T12:00:00Z', 'site-a'),
      urlOnly
    ])

    expect(found?.worktreeId).toBe('a-noon')
  })

  it('finds a folder workspace link, which lives outside the worktree metas', () => {
    const folder: FolderWorkspace = {
      id: 'notes',
      projectGroupId: 'group-1',
      name: 'Notes',
      folderPath: '/notes',
      linkedTask: null,
      linkedItems: [jiraLink('site-a')],
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 1,
      lastActivityAt: Date.parse('2026-11-14T09:00:00Z'),
      createdAt: 1,
      updatedAt: 1
    }

    const found = findTaskBoardWorkspace(siteACard, taskBoardWorkspaceCandidates([], [folder]))

    expect(found).toMatchObject({
      worktreeId: 'folder:notes',
      path: '/notes',
      isGitRepo: false,
      branch: null
    })
  })
})

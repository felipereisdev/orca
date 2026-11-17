import { describe, expect, it, vi } from 'vitest'
import type {
  JiraIssue,
  JiraIssueUpdate,
  JiraStatus,
  JiraTransition
} from '../../shared/jira/jira-types'
import { taskBoardRefKey } from '../../shared/task-board/task-board-provider-cards'
import { getDefaultTaskBoardSettings } from '../../shared/task-board/task-board-settings'
import type { WorkspaceStatusDefinition } from '../../shared/worktree/types'
import { createTaskBoardEnrichCaches } from './task-board-enrich'
import type { TaskBoardMoveDeps } from './task-board-host-move'
import { createTaskBoardMoveHolds } from './task-board-move-holds'
import { moveStartedTaskBoardCard } from './task-start-card-move'

const toDo: JiraStatus = { id: '1', name: 'To Do', categoryKey: 'new', categoryName: 'To Do' }
const inProgress: JiraStatus = {
  id: '3',
  name: 'In Progress',
  categoryKey: 'indeterminate',
  categoryName: 'In Progress'
}
const inReview: JiraStatus = { ...inProgress, id: '4', name: 'In Review' }

const BOARD: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
]

const ref = { provider: 'jira' as const, siteId: 'site-a', key: 'APP-1' }

function issue(status: JiraStatus): JiraIssue {
  return {
    id: '10',
    key: 'APP-1',
    siteId: 'site-a',
    title: 'Fix login',
    url: 'https://a.atlassian.net/browse/APP-1',
    project: { id: '1', key: 'APP', name: 'App' },
    issueType: { id: '1', name: 'Task' },
    status,
    labels: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-13T00:00:00Z'
  }
}

function unused(): never {
  throw new Error('not read in this scenario')
}

/** A Jira issue whose status really changes when a transition is applied. */
function jiraHost(
  status: JiraStatus,
  transitions: JiraTransition[],
  columns: WorkspaceStatusDefinition[] = BOARD
) {
  const state = { issue: issue(status) }
  const settings = getDefaultTaskBoardSettings()
  settings.providers.jira.rules = [{ match: 'In Review', statusId: 'in-review' }]
  const deps: TaskBoardMoveDeps = {
    host: {
      settings: () => ({ taskBoard: settings, visibleTaskProviders: ['jira'] }),
      statuses: () => columns
    },
    caches: createTaskBoardEnrichCaches(),
    moveHolds: createTaskBoardMoveHolds(),
    repo: () => null,
    getLocalGitArgs: () => [],
    jiraSites: () => [{ id: 'site-a', accountId: 'me' }],
    jiraSiteCount: () => 1,
    jiraIssue: async () => state.issue,
    jiraComments: unused,
    linearComments: unused,
    linearViewerId: unused,
    linearIssue: unused,
    gitlabWorkItemDetails: unused,
    gitlabWorkItemStatuses: unused,
    githubWorkItemDetails: unused,
    jiraTransitions: vi.fn(async () => transitions),
    updateJiraIssue: vi.fn(async (_key: string, updates: JiraIssueUpdate) => {
      const applied = transitions.find((candidate) => candidate.id === updates.transitionId)
      if (!applied) {
        return { ok: false as const, error: 'Transition is not valid' }
      }
      state.issue = { ...state.issue, status: applied.to }
      return { ok: true as const }
    }),
    linearTeamStates: unused,
    updateLinearIssue: unused,
    repoLabels: unused,
    updateGitLabIssue: unused,
    gitlabWorkItemStatusTarget: unused,
    updateGitLabWorkItemStatus: unused,
    updateGitHubIssue: unused
  }
  return { deps, state }
}

const start: JiraTransition = { id: '21', name: 'Start', to: inProgress }
const live = () => true

describe('moveStartedTaskBoardCard', () => {
  it('moves a card from Todo to In progress through its provider', async () => {
    const { deps, state } = jiraHost(toDo, [start])
    expect(await moveStartedTaskBoardCard(ref, 'in-progress', live, deps)).toBe('moved')
    expect(state.issue.status.name).toBe('In Progress')
  })

  it('clears what a drag clears and holds the card in In progress while lists lag', async () => {
    const { deps } = jiraHost(toDo, [start])
    const key = taskBoardRefKey(ref, null)
    deps.caches.comments.set(key, [])
    await moveStartedTaskBoardCard(ref, 'in-progress', live, deps)
    expect(deps.caches.comments.get(key)).toBeUndefined()
    expect(deps.moveHolds.place(key, 'todo')).toBe('in-progress')
  })

  it('writes nothing when the run stops while the card is read', async () => {
    let stopped = false
    const { deps, state } = jiraHost(toDo, [start])
    const read = deps.jiraIssue
    deps.jiraIssue = async (key, siteId) => {
      stopped = true
      return read(key, siteId)
    }
    expect(await moveStartedTaskBoardCard(ref, 'in-progress', () => !stopped, deps)).toBe('kept')
    expect(deps.updateJiraIssue).not.toHaveBeenCalled()
    expect(state.issue.status.name).toBe('To Do')
  })

  it('leaves a card already in In progress or a later column where it is', async () => {
    for (const status of [inProgress, inReview]) {
      const { deps, state } = jiraHost(status, [start])
      expect(await moveStartedTaskBoardCard(ref, 'in-progress', live, deps)).toBe('kept')
      expect(deps.updateJiraIssue).not.toHaveBeenCalled()
      expect(state.issue.status.name).toBe(status.name)
    }
  })

  it('leaves the card when the board has no In progress column', async () => {
    const { deps } = jiraHost(toDo, [start], [BOARD[0], BOARD[2], BOARD[3]])
    expect(await moveStartedTaskBoardCard(ref, 'in-progress', live, deps)).toBe('kept')
    expect(deps.jiraTransitions).not.toHaveBeenCalled()
  })

  it('skips a move that needs a choice or that the provider refuses', async () => {
    const hosts = [
      jiraHost(toDo, [start, { id: '22', name: 'Pick up', to: inProgress }]),
      jiraHost(toDo, []),
      jiraHost(toDo, [start])
    ]
    vi.mocked(hosts[2].deps.updateJiraIssue).mockResolvedValue({ ok: false, error: 'Forbidden' })
    for (const { deps, state } of hosts) {
      expect(await moveStartedTaskBoardCard(ref, 'in-progress', live, deps)).toBe('skipped')
      expect(state.issue.status.name).toBe('To Do')
    }
  })
})

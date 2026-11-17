import { describe, expect, it } from 'vitest'
import type {
  JiraIssue,
  JiraIssueUpdate,
  JiraStatus,
  JiraTransition
} from '../../shared/jira/jira-types'
import { getDefaultTaskBoardSettings } from '../../shared/task-board/task-board-settings'
import { createTaskBoardEnrichCaches } from './task-board-enrich'
import { createTaskBoardMoveHolds } from './task-board-move-holds'
import { decideJiraMove, moveTaskBoardCard, type TaskBoardMoveDeps } from './task-board-host-move'

const inProgress: JiraStatus = {
  id: '3',
  name: 'In Progress',
  categoryKey: 'indeterminate',
  categoryName: 'In Progress'
}
const done: JiraStatus = { id: '5', name: 'Done', categoryKey: 'done', categoryName: 'Done' }

const resolutionField = {
  key: 'resolution',
  name: 'Resolution',
  required: true,
  allowedValues: [
    { id: '10', name: 'Fixed' },
    { id: '11', name: "Won't do" }
  ]
}

function transition(id: string, name: string, fields?: JiraTransition['fields']): JiraTransition {
  return { id, name, to: done, ...(fields ? { fields } : {}) }
}

describe('decideJiraMove', () => {
  it('blocks a column no transition reaches', () => {
    expect(decideJiraMove([], {})).toEqual({ status: 'blocked', reason: 'no-transition' })
  })

  it('asks which transition when two reach the column, describing each one’s fields', () => {
    const candidates = [
      transition('31', 'Resolve', [resolutionField]),
      transition('41', 'Close', [{ key: 'customfield_9', name: 'Root cause', required: true }])
    ]
    expect(decideJiraMove(candidates, {})).toEqual({
      status: 'needs-choice',
      choices: [
        {
          id: '31',
          name: 'Resolve',
          fields: {
            resolution: {
              name: 'Resolution',
              required: true,
              options: [
                { id: '10', name: 'Fixed' },
                { id: '11', name: "Won't do" }
              ]
            },
            commentRequired: false
          }
        },
        {
          id: '41',
          name: 'Close',
          fields: 'unsupported',
          unsupportedFieldNames: ['Root cause']
        }
      ]
    })
  })

  it('refuses a choice that is not one of the column’s transitions', () => {
    const candidates = [transition('31', 'Resolve'), transition('41', 'Close')]
    expect(decideJiraMove(candidates, { choiceId: 'x' })).toEqual({
      status: 'blocked',
      reason: 'invalid-choice'
    })
  })

  it('asks for the resolution a transition requires before applying it', () => {
    expect(decideJiraMove([transition('31', 'Resolve', [resolutionField])], {})).toMatchObject({
      status: 'needs-fields',
      choice: { id: '31', name: 'Resolve' }
    })
  })

  it('applies a transition with the chosen resolution', () => {
    expect(
      decideJiraMove([transition('31', 'Resolve', [resolutionField])], {
        choiceId: '31',
        fields: { resolutionId: '11' }
      })
    ).toEqual({ kind: 'apply', transitionId: '31', transitionFields: { resolution: { id: '11' } } })
  })

  it('sends a transition with fields the phone cannot fill to desktop or web', () => {
    const close = transition('41', 'Close', [
      { key: 'customfield_9', name: 'Root cause', required: true }
    ])
    expect(decideJiraMove([close], { fields: { comment: 'Done' } })).toEqual({
      status: 'unsupported-fields',
      choice: {
        id: '41',
        name: 'Close',
        fields: 'unsupported',
        unsupportedFieldNames: ['Root cause']
      }
    })
  })
})

const issue: JiraIssue = {
  id: '10',
  key: 'APP-1',
  siteId: 'site-a',
  title: 'Fix login',
  url: 'https://a.atlassian.net/browse/APP-1',
  project: { id: '1', key: 'APP', name: 'App' },
  issueType: { id: '1', name: 'Task' },
  status: inProgress,
  labels: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-13T00:00:00Z'
}
const ref = { provider: 'jira' as const, siteId: 'site-a', key: 'APP-1' }

function unused(): never {
  throw new Error('not read in this scenario')
}

/** A Jira issue that really changes status when a transition is applied. */
function jiraHost(transitions: JiraTransition[], options: { rereadFails?: boolean } = {}) {
  const state = { issue, reads: 0 }
  const deps: TaskBoardMoveDeps = {
    host: {
      settings: () => ({
        taskBoard: getDefaultTaskBoardSettings(),
        visibleTaskProviders: ['jira']
      }),
      statuses: () => [
        { id: 'todo', label: 'Todo' },
        { id: 'in-progress', label: 'In progress' },
        { id: 'completed', label: 'Done' }
      ]
    },
    caches: createTaskBoardEnrichCaches(),
    moveHolds: createTaskBoardMoveHolds(),
    repo: () => null,
    getLocalGitArgs: () => [],
    jiraSites: () => [{ id: 'site-a', accountId: 'me' }],
    jiraSiteCount: () => 1,
    jiraIssue: async () => {
      state.reads += 1
      if (options.rereadFails && state.reads > 1) {
        throw new Error('Jira is unreachable')
      }
      return state.issue
    },
    jiraComments: unused,
    linearComments: unused,
    linearViewerId: unused,
    linearIssue: unused,
    gitlabWorkItemDetails: unused,
    gitlabWorkItemStatuses: unused,
    githubWorkItemDetails: unused,
    jiraTransitions: async () => transitions,
    updateJiraIssue: async (_key, updates: JiraIssueUpdate) => {
      const applied = transitions.find((candidate) => candidate.id === updates.transitionId)
      if (!applied) {
        return { ok: false, error: 'Transition is not valid' }
      }
      state.issue = { ...state.issue, status: applied.to }
      return { ok: true }
    },
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

describe('moveTaskBoardCard', () => {
  it('reports a confirmed move whose re-read failed as moved, so a retry never repeats it', async () => {
    const { deps, state } = jiraHost([transition('31', 'Done')], { rereadFails: true })
    expect(await moveTaskBoardCard({ ref, targetColumnId: 'completed' }, deps)).toEqual({
      status: 'moved',
      card: null
    })
    expect(state.issue.status.name).toBe('Done')
  })

  it('never applies a transition outside the requested column’s candidates', async () => {
    const reopen = { ...transition('11', 'Reopen'), to: { ...inProgress, name: 'To Do' } }
    const { deps, state } = jiraHost([transition('31', 'Done'), reopen])
    expect(
      await moveTaskBoardCard({ ref, targetColumnId: 'completed', choiceId: '11' }, deps)
    ).toEqual({ status: 'blocked', reason: 'invalid-choice' })
    expect(state.issue.status.name).toBe('In Progress')
  })

  it('answers with the card as the provider reads it after the move', async () => {
    const { deps } = jiraHost([transition('31', 'Done')])
    const result = await moveTaskBoardCard({ ref, targetColumnId: 'completed' }, deps)
    expect(result.status === 'moved' ? result.card?.columnId : result).toBe('completed')
  })
})

const gitlabRef = {
  provider: 'gitlab' as const,
  repoId: 'app',
  number: 7,
  projectRef: { host: 'git.example.com', path: 'acme/app' }
}
const toDoStatus = { id: 'gid://status/30', name: 'To do' }
const inReviewStatus = { id: 'gid://status/39', name: 'In review' }
const doneStatus = { id: 'gid://status/27', name: 'Done' }

/** A GitLab issue whose Status (or labels) really change when written. */
function gitlabHost(status: { id: string; name: string } | null) {
  const state: {
    status: { id: string; name: string } | null
    labels: string[]
    statusWrites: string[]
  } = { status, labels: [], statusWrites: [] }
  const settings = getDefaultTaskBoardSettings()
  settings.providers.gitlab.rules = [
    { match: 'To do', statusId: 'todo' },
    { match: 'workflow::doing', statusId: 'in-progress' },
    { match: 'In review', statusId: 'in-review' }
  ]
  const deps: TaskBoardMoveDeps = {
    host: {
      settings: () => ({ taskBoard: settings, visibleTaskProviders: ['gitlab'] }),
      statuses: () => [
        { id: 'todo', label: 'Todo' },
        { id: 'in-progress', label: 'In progress' },
        { id: 'in-review', label: 'In review' },
        { id: 'completed', label: 'Done' }
      ]
    },
    caches: createTaskBoardEnrichCaches(),
    moveHolds: createTaskBoardMoveHolds(),
    repo: () => ({ id: 'app', path: '/src/app', displayName: 'app', badgeColor: '', addedAt: 1 }),
    getLocalGitArgs: () => [],
    jiraSites: () => [],
    jiraSiteCount: () => 0,
    jiraIssue: unused,
    jiraComments: unused,
    linearComments: unused,
    linearViewerId: unused,
    linearIssue: unused,
    gitlabWorkItemDetails: async () => ({
      item: {
        id: 'x',
        type: 'issue',
        number: 7,
        title: 'Fix login',
        state: 'opened',
        url: 'https://git.example.com/acme/app/-/issues/7',
        labels: state.labels,
        updatedAt: '2026-11-13T00:00:00Z',
        author: null
      },
      body: '',
      comments: []
    }),
    gitlabWorkItemStatuses: async () => (state.status ? new Map([[7, state.status]]) : null),
    githubWorkItemDetails: unused,
    jiraTransitions: unused,
    updateJiraIssue: unused,
    linearTeamStates: unused,
    updateLinearIssue: unused,
    repoLabels: async () => [],
    updateGitLabIssue: async (_path, _number, updates) => {
      state.labels = [...state.labels, ...(updates.addLabels ?? [])]
      return { ok: true }
    },
    gitlabWorkItemStatusTarget: async () => ({
      workItemId: 'gid://gitlab/WorkItem/385444',
      status: state.status,
      lifecycle: {
        allowedStatuses: [toDoStatus, inReviewStatus, doneStatus],
        defaultOpenStatus: toDoStatus,
        defaultClosedStatus: doneStatus
      }
    }),
    updateGitLabWorkItemStatus: async (_path, _project, workItemId, statusId) => {
      state.statusWrites.push(`${workItemId} → ${statusId}`)
      state.status = [toDoStatus, inReviewStatus, doneStatus].find((s) => s.id === statusId)!
      return { ok: true }
    },
    updateGitHubIssue: unused
  }
  return { deps, state }
}

describe('moveTaskBoardCard on GitLab', () => {
  it('sets the matching allowed Status of a card that has one, leaving labels alone', async () => {
    const { deps, state } = gitlabHost(toDoStatus)
    const result = await moveTaskBoardCard({ ref: gitlabRef, targetColumnId: 'in-review' }, deps)
    expect(result.status === 'moved' ? result.card?.columnId : result).toBe('in-review')
    expect(state.statusWrites).toEqual(['gid://gitlab/WorkItem/385444 → gid://status/39'])
    expect(state.labels).toEqual([])
  })

  it('blocks a column whose rules name no allowed Status, instead of adding a label', async () => {
    const { deps, state } = gitlabHost(toDoStatus)
    expect(
      await moveTaskBoardCard({ ref: gitlabRef, targetColumnId: 'in-progress' }, deps)
    ).toEqual({ status: 'blocked', reason: 'no-mapping' })
    expect(state.statusWrites).toEqual([])
  })

  it('sets the lifecycle’s default closed Status for the done column no rule names', async () => {
    const { deps, state } = gitlabHost(inReviewStatus)
    await moveTaskBoardCard({ ref: gitlabRef, targetColumnId: 'completed' }, deps)
    expect(state.statusWrites).toEqual(['gid://gitlab/WorkItem/385444 → gid://status/27'])
  })

  it('moves a card without a Status by labels', async () => {
    const { deps, state } = gitlabHost(null)
    const result = await moveTaskBoardCard({ ref: gitlabRef, targetColumnId: 'in-review' }, deps)
    expect(result.status).toBe('moved')
    expect(state.labels).toEqual(['In review'])
    expect(state.statusWrites).toEqual([])
  })
})

import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getEnvironmentRuntimeContextKey } from '@/runtime/hosts/observations/provider-runtime-context'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import { gitLabApiFor } from '@/runtime/repository-gitlab/gitlab-owner-api'
import { getLinearTargetScope } from '@/store/slices/linear/linear-slice-scope'
import '@/store/slices/linear/linear-issue-read'
import { confirmLinearIssueWrite } from '@/store/slices/linear/linear-issue-write-publication'
import { linearUpdateIssueForTarget } from '@/runtime/linear/runtime-linear-issue-client'
import { linearTeamStatesForTarget } from '@/runtime/linear/runtime-linear-project-client'
import { runIssueUpdate } from '@/components/github/github-work-item-edit-mutations'
import {
  enqueueJiraIssueMutation,
  jiraIssueRequestScope
} from '@/components/jira-issue-mutation-queue'
import { loadTaskPageJiraIssueTransitions } from '@/components/task-page/jira/task-page-jira-board-transitions'
import { applyJiraBoardMove } from '@/components/task-page/jira/task-page-jira-board-move'
import { gitHubTaskBoardRepoArgs } from '@/lib/work-items/task-board/adapters/github-task-board-adapter'
import { gitLabTaskBoardRepoSelector } from '@/lib/work-items/task-board/adapters/gitlab-task-board-adapter'
import { resolveJiraTaskBoardTarget } from '@/lib/work-items/task-board/adapters/jira-task-board-adapter'
import { resolveLinearTaskBoardTarget } from '@/lib/work-items/task-board/adapters/linear-task-board-adapter'
import { findTaskBoardRepo } from '@/lib/work-items/task-board/adapters/task-board-provider-scope'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import {
  selectJiraMoveTransitions,
  selectLinearMoveStates,
  type LabelProviderMove
} from '@/lib/work-items/task-board/task-board-move-targets'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { parseGitHubItemRepository } from '../../../../../shared/github/work-items/work-item-target'
import type {
  JiraIssue,
  JiraIssueUpdate,
  JiraTransition
} from '../../../../../shared/jira/jira-types'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import type { LinearWorkflowState } from '../../../../../shared/linear/workspace-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { TaskBoardSettings } from '../../../../../shared/task-board/task-board-settings'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'

export type TaskBoardMoveTargetArgs = {
  columnId: string
  columnLabel: string
  columns: readonly WorkspaceStatusDefinition[]
  settings: TaskBoardSettings
}

export function taskBoardMoveErrorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : translate('auto.components.taskPageJiraBoard.changeStatusFailed', 'Failed to change status.')
}

/** Jira/Linear write through the Tasks page's account-backed host, as the board reads them. */
export function requireTaskBoardTarget(
  provider: 'jira' | 'linear',
  accountHostId: ExecutionHostId
): RuntimeClientTarget {
  const target =
    provider === 'jira'
      ? resolveJiraTaskBoardTarget(accountHostId)
      : resolveLinearTaskBoardTarget(accountHostId)
  if (!target) {
    throw new Error(
      translate('taskBoard.providerUnavailable', '{{provider}} is not connected.', {
        provider: provider === 'jira' ? 'Jira' : 'Linear'
      })
    )
  }
  return target
}

function noStatusChangeError(column: string, key: string): Error {
  return new Error(
    translate(
      'jira.board.noTransition',
      'No status change to {{column}} is available for {{key}}.',
      {
        column,
        key
      }
    )
  )
}

function runtimeContextKey(target: RuntimeClientTarget): string {
  return getEnvironmentRuntimeContextKey(runtimeTargetEnvironmentId(target))
}

/** Never empty. Every drop reads fresh transitions: a cached failure would block the retry. */
export async function loadJiraTaskBoardMoveTransitions(
  target: RuntimeClientTarget,
  issue: JiraIssue,
  { columnId, columnLabel, columns, settings }: TaskBoardMoveTargetArgs
): Promise<JiraTransition[]> {
  const scopeKey = JSON.stringify(['task-board', runtimeContextKey(target)])
  const transitions = await loadTaskPageJiraIssueTransitions(target, scopeKey, issue, true)
  const candidates = selectJiraMoveTransitions(transitions, columnId, columns, settings)
  if (candidates.length === 0) {
    throw noStatusChangeError(columnLabel, issue.key)
  }
  return candidates
}

export async function applyJiraTaskBoardMove(
  target: RuntimeClientTarget,
  issue: JiraIssue,
  transition: JiraTransition,
  updates: JiraIssueUpdate
): Promise<void> {
  const scope = jiraIssueRequestScope(issue, null, {
    activeRuntimeEnvironmentId: runtimeTargetEnvironmentId(target)
  })
  if (!scope) {
    throw new Error(taskBoardMoveErrorMessage(null))
  }
  const patchOptions = {
    sourceContext: null,
    siteId: issue.siteId,
    contextKey: runtimeContextKey(target)
  }
  let latest: JiraIssue | null = null
  await enqueueJiraIssueMutation({
    scope,
    previous: issue,
    optimistic: { status: transition.to },
    commentsChanged: Boolean(updates.transitionComment?.trim()),
    update: async () => {
      const saved = await applyJiraBoardMove(target, issue, updates)
      latest = saved.latest
      return saved.result
    },
    refresh: async () => latest,
    patchIssue: (patch) => useAppStore.getState().patchJiraIssue(issue.key, patch, patchOptions)
  })
}

/** Never empty. */
export async function loadLinearTaskBoardMoveStates(
  target: RuntimeClientTarget,
  issue: LinearIssue,
  { columnId, columnLabel, columns, settings }: TaskBoardMoveTargetArgs
): Promise<LinearWorkflowState[]> {
  const states = await linearTeamStatesForTarget(target, issue.team.id, issue.workspaceId)
  const candidates = selectLinearMoveStates(states, columnId, columns, settings)
  if (candidates.length === 0) {
    throw noStatusChangeError(columnLabel, issue.identifier)
  }
  return candidates
}

export async function applyLinearTaskBoardMove(
  target: RuntimeClientTarget,
  issue: LinearIssue,
  state: LinearWorkflowState
): Promise<void> {
  const result = await linearUpdateIssueForTarget(
    target,
    issue.id,
    { stateId: state.id },
    issue.workspaceId
  )
  if (result.ok === false) {
    throw new Error(result.error)
  }
  confirmLinearIssueWrite({ scope: getLinearTargetScope(target), id: issue.id })
}

function missingRepoError(card: TaskBoardCard): Error {
  return new Error(
    translate('taskBoard.repoUnavailable', 'The repository for {{id}} is no longer in Orca.', {
      id: card.displayId
    })
  )
}

/** Applies a GitLab/GitHub open/closed + label move in the repo the card was read from. */
export async function applyTaskBoardLabelMove(
  card: TaskBoardCard,
  move: Extract<LabelProviderMove, { ok: true }>
): Promise<void> {
  const { source } = card
  if (source.provider === 'gitlab') {
    const repo = findTaskBoardRepo('gitlab', source.item)
    if (!repo) {
      throw missingRepoError(card)
    }
    const selector = gitLabTaskBoardRepoSelector(repo)
    const result = await gitLabApiFor(selector).updateIssue({
      ...selector,
      number: source.item.number,
      updates: {
        ...(move.state ? { state: move.state === 'open' ? 'opened' : 'closed' } : {}),
        addLabels: move.addLabels,
        removeLabels: move.removeLabels
      }
    })
    if (!result.ok) {
      throw new Error(result.error)
    }
    return
  }
  if (source.provider === 'github') {
    const repo = findTaskBoardRepo('github', source.item)
    if (!repo) {
      throw missingRepoError(card)
    }
    const { repoId, path, sourceContext } = gitHubTaskBoardRepoArgs(repo)
    await runIssueUpdate({
      repoPath: path,
      repoId,
      sourceContext,
      projectOrigin: undefined,
      issueRepo: parseGitHubItemRepository(source.item.url),
      number: source.item.number,
      updates: {
        ...(move.state ? { state: move.state } : {}),
        addLabels: move.addLabels,
        removeLabels: move.removeLabels
      }
    })
  }
}

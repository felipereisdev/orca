import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getEnvironmentRuntimeContextKey } from '@/runtime/hosts/observations/provider-runtime-context'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import { getLinearTargetScope } from '@/store/slices/linear/linear-slice-scope'
import '@/store/slices/linear/linear-issue-read'
import { confirmLinearIssueWrite } from '@/store/slices/linear/linear-issue-write-publication'
import { linearUpdateIssueForTarget } from '@/runtime/linear/runtime-linear-issue-client'
import { linearTeamStatesForTarget } from '@/runtime/linear/runtime-linear-project-client'
import {
  enqueueJiraIssueMutation,
  jiraIssueRequestScope
} from '@/components/jira-issue-mutation-queue'
import { loadTaskPageJiraIssueTransitions } from '@/components/task-page/jira/task-page-jira-board-transitions'
import { applyJiraBoardMove } from '@/components/task-page/jira/task-page-jira-board-move'
import {
  resolveJiraTaskBoardTarget,
  toJiraTaskBoardCard
} from '@/lib/work-items/task-board/adapters/jira-task-board-adapter'
import {
  resolveLinearTaskBoardTarget,
  toLinearTaskBoardCard
} from '@/lib/work-items/task-board/adapters/linear-task-board-adapter'
import type { TaskBoardCard } from '@/lib/work-items/task-board/task-board-card'
import {
  selectJiraMoveTransitions,
  selectLinearMoveStates
} from '@/lib/work-items/task-board/task-board-move-targets'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
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

/** The card a confirmed move shows: the provider's new facts under the board's own identity. */
export function confirmedTaskBoardCard(
  card: TaskBoardCard,
  confirmed: TaskBoardCard
): TaskBoardCard {
  return { ...confirmed, refKey: card.refKey, projectLabel: card.projectLabel }
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

/** Resolves to the card as Jira reads it after the transition. */
export async function applyJiraTaskBoardMove(
  target: RuntimeClientTarget,
  card: TaskBoardCard,
  issue: JiraIssue,
  transition: JiraTransition,
  updates: JiraIssueUpdate
): Promise<TaskBoardCard> {
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
  const saved: { latest: JiraIssue | null } = { latest: null }
  await enqueueJiraIssueMutation({
    scope,
    previous: issue,
    optimistic: { status: transition.to },
    commentsChanged: Boolean(updates.transitionComment?.trim()),
    update: async () => {
      const result = await applyJiraBoardMove(target, issue, updates)
      saved.latest = result.latest
      return result.result
    },
    refresh: async () => saved.latest,
    patchIssue: (patch) => useAppStore.getState().patchJiraIssue(issue.key, patch, patchOptions)
  })
  const confirmed = saved.latest ?? {
    ...issue,
    status: transition.to,
    updatedAt: new Date().toISOString()
  }
  return confirmedTaskBoardCard(card, toJiraTaskBoardCard(confirmed))
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

/** Resolves to the card in `state`; Linear's update returns no issue to read it from. */
export async function applyLinearTaskBoardMove(
  target: RuntimeClientTarget,
  card: TaskBoardCard,
  issue: LinearIssue,
  state: LinearWorkflowState
): Promise<TaskBoardCard> {
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
  const confirmed: LinearIssue = {
    ...issue,
    state: { name: state.name, type: state.type, color: state.color },
    updatedAt: new Date().toISOString()
  }
  return confirmedTaskBoardCard(card, toLinearTaskBoardCard(confirmed))
}

import { getLinearPriorityLabel } from '@/components/task-page/task-page-localized-options'
import { linearListIssues, linearStatusForTarget } from '@/runtime/linear/runtime-linear-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../../shared/execution-host'
import type { LinearIssue } from '../../../../../../shared/linear/issue-types'
import { linearStatusCategory, type TaskBoardCard } from '../task-board-card'
import {
  disconnectedTaskBoardResult,
  failedTaskBoardResult,
  isWithinDoneWindow,
  type TaskBoardProviderResult
} from '../task-board-provider-results'
import { isTaskBoardProviderVisible } from './task-board-provider-scope'

const ASSIGNED_LIMIT = 100
const COMPLETED_LIMIT = 100

export function toLinearTaskBoardCard(issue: LinearIssue): TaskBoardCard {
  return {
    refKey: `linear:${issue.workspaceId ?? ''}:${issue.id}`,
    provider: 'linear',
    displayId: issue.identifier,
    title: issue.title,
    url: issue.url,
    projectLabel: issue.project?.name ?? issue.team.key,
    statusName: issue.state.name,
    category: linearStatusCategory(issue.state.type),
    labels: issue.labels,
    ...(issue.priority > 0 ? { priorityLabel: getLinearPriorityLabel(issue.priority) } : {}),
    updatedAt: issue.updatedAt,
    source: { provider: 'linear', item: issue }
  }
}

async function readLinearCards(
  signal: AbortSignal,
  accountHostId: ExecutionHostId
): Promise<TaskBoardProviderResult> {
  const parsed = parseExecutionHostId(accountHostId)
  // Linear has no SSH relay, matching Cmd-J.
  if (!isTaskBoardProviderVisible('linear') || !parsed || parsed.kind === 'ssh') {
    return disconnectedTaskBoardResult('linear')
  }
  const target = ipcOrRuntimeTargetForHostId(parsed.id)
  if (!target) {
    return disconnectedTaskBoardResult('linear')
  }
  const status = await linearStatusForTarget(target)
  if (signal.aborted || !status.connected) {
    return disconnectedTaskBoardResult('linear')
  }
  // 'completed' reads the viewer's assigned issues too, but includes canceled ones.
  const [assigned, completed] = await Promise.all([
    linearListIssues(target, 'assigned', ASSIGNED_LIMIT, 'all'),
    linearListIssues(target, 'completed', COMPLETED_LIMIT, 'all')
  ])
  const now = new Date()
  const cards = [
    ...assigned.items.map(toLinearTaskBoardCard),
    ...completed.items
      .filter((issue) => isWithinDoneWindow(issue.updatedAt, now))
      .map(toLinearTaskBoardCard)
  ].filter((card) => card.category !== 'excluded')
  const workspaceError = [...(assigned.errors ?? []), ...(completed.errors ?? [])][0]
  if (workspaceError && assigned.items.length + completed.items.length === 0) {
    return failedTaskBoardResult('linear', workspaceError.message)
  }
  return { provider: 'linear', status: 'ready', cards }
}

/** `accountHostId` is the Tasks page's account-backed source host (Cmd-J's `accountBackedTaskSourceHostId`). */
export async function listLinearTaskBoardCards(
  signal: AbortSignal,
  accountHostId: ExecutionHostId
): Promise<TaskBoardProviderResult> {
  try {
    return await readLinearCards(signal, accountHostId)
  } catch (error) {
    return failedTaskBoardResult('linear', error)
  }
}

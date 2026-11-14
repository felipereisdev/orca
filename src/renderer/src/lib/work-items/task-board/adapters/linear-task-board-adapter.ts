import { failedTaskBoardResult } from './task-board-failed-result'
import { getLinearPriorityLabel } from '@/components/task-page/task-page-localized-options'
import { linearListIssues, linearStatusForTarget } from '@/runtime/linear/runtime-linear-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../../shared/execution-host'
import type { LinearIssue } from '../../../../../../shared/linear/issue-types'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { toLinearTaskBoardCard } from '../../../../../../shared/task-board/task-board-provider-cards'
import {
  disconnectedTaskBoardResult,
  isWithinDoneWindow,
  type TaskBoardProviderResult
} from '../../../../../../shared/task-board/task-board-provider-results'
import { isTaskBoardProviderVisible } from './task-board-provider-scope'

const ASSIGNED_LIMIT = 100
const COMPLETED_LIMIT = 100

/** Where the board reads and writes Linear for the Tasks page's account-backed host. */
export function resolveLinearTaskBoardTarget(
  accountHostId: ExecutionHostId
): RuntimeClientTarget | null {
  const parsed = parseExecutionHostId(accountHostId)
  // Linear has no SSH relay, matching Cmd-J.
  return parsed && parsed.kind !== 'ssh' ? ipcOrRuntimeTargetForHostId(parsed.id) : null
}

async function readLinearCards(
  signal: AbortSignal,
  accountHostId: ExecutionHostId
): Promise<TaskBoardProviderResult> {
  const target = isTaskBoardProviderVisible('linear')
    ? resolveLinearTaskBoardTarget(accountHostId)
    : null
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
  const toCard = (issue: LinearIssue) => toLinearTaskBoardCard(issue, getLinearPriorityLabel)
  const cards = [
    ...assigned.items.map(toCard),
    ...completed.items.filter((issue) => isWithinDoneWindow(issue.updatedAt, now)).map(toCard)
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

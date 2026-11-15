import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/workspace/tabs/activate-tab-and-focus-pane'
import { activateTerminalTabOnOwner } from '@/lib/workspace/tabs/terminal-tab-owner-activation'
import {
  activateStructuredAgentSessionTab,
  activateStructuredAgentSessionTabOnOwner
} from '@/lib/agent-session/structured-agent-session-tab-activation'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskStartRunSummary } from '../../../../../shared/task-board/task-start-run'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree/id'
import { parsePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'

/** The run's workspace host as this window names it: a paired host's own, else the orchestrator's (local or SSH). */
function runExecutionHostId(
  run: TaskStartRunSummary,
  boardHostId: ExecutionHostId
): ExecutionHostId | undefined {
  if (parseExecutionHostId(boardHostId)?.kind === 'runtime') {
    return boardHostId
  }
  return parseExecutionHostId(run.orchestrator?.hostId)?.id
}

function focusOrchestrator(
  worktreeId: string,
  orchestrator: NonNullable<TaskStartRunSummary['orchestrator']>
): void {
  if (orchestrator.surface === 'chat') {
    const shown =
      orchestrator.tabId !== undefined &&
      activateStructuredAgentSessionTab({ worktreeId, tabId: orchestrator.tabId })
    if (!shown && orchestrator.sessionId) {
      activateStructuredAgentSessionTabOnOwner(worktreeId, orchestrator.sessionId)
    }
    return
  }
  const pane = orchestrator.paneKey ? parsePaneKey(orchestrator.paneKey) : null
  if (!pane) {
    return
  }
  const tabs = useAppStore.getState().tabsByWorktree[worktreeId] ?? []
  if (tabs.some((tab) => tab.id === pane.tabId)) {
    activateTabAndFocusPane(pane.tabId, pane.leafId, { flashFocusedPane: true })
  }
  activateTerminalTabOnOwner(worktreeId, pane.tabId, pane.leafId)
}

/** Opens the run's worktree and focuses its orchestrator; false when the worktree cannot be shown. */
export async function openTaskStartRun(
  run: TaskStartRunSummary,
  boardHostId: ExecutionHostId
): Promise<boolean> {
  const worktreeId = run.orchestrator?.worktreeId ?? run.worktreeId
  if (!worktreeId) {
    return false
  }
  const executionHostId = runExecutionHostId(run, boardHostId)
  const hostOptions = executionHostId ? { executionHostId } : {}
  // A worktree the host just created may not have reached this window's list yet.
  if (!useAppStore.getState().getKnownWorktreeById(worktreeId, executionHostId)) {
    await useAppStore
      .getState()
      .fetchWorktrees(
        getRepoIdFromWorktreeId(worktreeId),
        executionHostId && parseExecutionHostId(executionHostId)?.kind === 'runtime'
          ? hostOptions
          : {}
      )
      .catch((error: unknown) =>
        console.warn('[task-start] listing the run worktree failed', error)
      )
  }
  const opened = activateAndRevealWorktree(worktreeId, {
    ...hostOptions,
    navigationIntent: 'user-open'
  })
  if (opened === false) {
    return false
  }
  if (run.orchestrator) {
    focusOrchestrator(worktreeId, run.orchestrator)
  }
  return true
}

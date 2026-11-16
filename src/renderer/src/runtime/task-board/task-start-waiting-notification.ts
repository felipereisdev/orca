import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { resolveNotificationTabOwner } from '@/attention/notification-subject-owner'
import { getNotificationWorkspaceLabels } from '@/attention/notification-workspace-labels'
import {
  deliverAgentAttentionNotification,
  readAgentAttentionNotificationSound
} from '@/attention/agent-attention-notification-delivery'
import {
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import {
  notificationExecutionHostForOwner,
  notificationSourceForOwner,
  notificationWorkspaceExecutionHostForOwner
} from '../../../../shared/notifications/notification-source'

export type TaskStartWaitingItem = { cardKey: string; worktreeId: string; title: string }

/** The "agent needs input" notification for a run that began waiting; clicking opens its worktree. */
export function notifyTaskStartWaiting(
  boardHostId: ExecutionHostId,
  item: TaskStartWaitingItem
): void {
  const state = useAppStore.getState()
  // A paired host's worktree ids live on that host; the local board's may be local or SSH rows.
  const runtimeHost =
    parseExecutionHostId(boardHostId)?.kind === 'runtime' ? boardHostId : undefined
  const owner = resolveNotificationTabOwner(state, {
    worktreeId: item.worktreeId,
    ...(runtimeHost ? { executionHostId: runtimeHost } : {})
  })
  const executionHost = notificationExecutionHostForOwner(owner)
  deliverAgentAttentionNotification(
    {
      source: 'agent-task-complete',
      worktreeId: item.worktreeId,
      workspaceExecutionHostId: notificationWorkspaceExecutionHostForOwner(owner),
      ...(executionHost ? { executionHost } : {}),
      notificationSourceId: notificationSourceForOwner(owner, state),
      ...getNotificationWorkspaceLabels(state, item.worktreeId, item.title),
      terminalTitle: item.title,
      agentState: 'waiting',
      agentLastAssistantMessage: translate(
        'taskStart.waitingNotification',
        '{{title}} is waiting for you',
        { title: item.title }
      ),
      isActiveWorktree: state.activeWorktreeId === item.worktreeId
    },
    readAgentAttentionNotificationSound(state.settings ?? {})
  )
}

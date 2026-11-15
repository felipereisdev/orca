import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../src/shared/agent-session/view/structured-agent-session-projection'
import { parseExecutionHostId } from '../../../../src/shared/execution-host'
import type { TaskStartRunSummary } from '../../../../src/shared/task-board/task-start-run'
import { hostStackRouteHref, type HostStackRouteHref } from '../../navigation/host-stack-navigation'
import { mobileSessionRouteTarget } from '../../session/mobile-session-route'

// A terminal orchestrator names its pane; a chat one its session, which the session screen opens natively.
function orchestratorPaneKey(run: TaskStartRunSummary): string | undefined {
  const orchestrator = run.orchestrator
  if (orchestrator?.surface === 'chat' && orchestrator.sessionId) {
    return structuredAgentSessionPaneKey(
      structuredAgentSessionTabId(orchestrator.sessionId),
      orchestrator.sessionId
    )
  }
  return orchestrator?.paneKey
}

/** The orchestrator's session: its pane on the host, or a `runtime:` server's own workspace. */
export function taskStartRunSessionHref(
  hostId: string,
  run: TaskStartRunSummary
): HostStackRouteHref | null {
  const worktreeId = run.orchestrator?.worktreeId ?? run.worktreeId
  if (!worktreeId) {
    return null
  }
  const paneKey = orchestratorPaneKey(run)
  const server = parseExecutionHostId(run.orchestrator?.hostId)
  return hostStackRouteHref(
    mobileSessionRouteTarget({
      hostId,
      worktreeId,
      ...(paneKey ? { paneKey } : {}),
      ...(server?.kind === 'runtime' ? { executionHost: server.id } : {})
    })
  )
}

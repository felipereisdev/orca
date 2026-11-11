import type { RpcContext } from '../rpc/core'

export function databaseTerminalCaller(context: RpcContext) {
  const evidence = context.orchestrationCompatibilityEvidence
  if (context.orchestrationCaller || !evidence) {
    return undefined
  }
  if (context.caller?.kind !== 'local-cli') {
    throw new Error('Database terminal evidence requires its local runtime')
  }
  const caller = context.runtime.verifyOrchestrationCompatibilityCaller(evidence, {
    currentRuntimeLaunchSufficient: true
  })
  const terminal =
    caller && context.runtime.getOrchestrationDispatchAuthority(caller.terminalHandle)
  if (!caller || !terminal || terminal.processIncarnation !== caller.processIncarnation) {
    throw new Error('Database terminal caller is no longer live')
  }
  return {
    terminalHandle: caller.terminalHandle,
    workspaceId: terminal.worktreeId,
    sessionId: `terminal:${caller.terminalHandle}:${caller.processIncarnation}`
  }
}

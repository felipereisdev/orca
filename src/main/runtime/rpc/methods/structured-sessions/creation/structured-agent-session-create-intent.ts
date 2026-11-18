import { structuredAgentSessionCreateFingerprint } from '../../../../../../shared/agent-session/lifecycle/operations/structured-agent-session-mutation'
import type { AgentSessionMutationEnvelope } from '../../../../../../shared/agent-session/agent-session-wire'
import type {
  StructuredAgentSessionResumeSource,
  StructuredAgentSessionFirstMessage
} from '../../../../../../shared/agent-session/lifecycle/operations/structured-agent-session-create'

/** New creates keep the immutable client intent in the ledger; legacy creates keep attach identity. */
export function structuredAgentSessionCreateIntentFingerprint(params: {
  envelope: AgentSessionMutationEnvelope
  worktree: string
  agent: string
  claudeAccountId?: string
  forkFrom?: { sessionId: string; throughItemId: string }
  resumeFrom?: StructuredAgentSessionResumeSource
  tabId?: string
  firstMessage?: StructuredAgentSessionFirstMessage
  optionsMode?: 'replace-model-selection'
  options?: Readonly<Record<string, string>>
}): string {
  return structuredAgentSessionCreateFingerprint({
    ...params,
    sessionId: params.envelope.sessionId
  })
}

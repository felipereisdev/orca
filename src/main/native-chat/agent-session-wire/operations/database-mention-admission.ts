import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { DatabaseMentionReference } from '../../../../shared/database/database-mention-reference'
import type { StructuredAgentSessionHostDeps } from '../host/structured-agent-session-host-types'
import { refuse } from '../../../../shared/agent-session/failures/agent-session-wire-refusals'
export async function databaseMentionAdmission(
  deps: Pick<StructuredAgentSessionHostDeps, 'validateDatabaseMentions'>,
  record: AgentSessionRecord | null,
  references: readonly DatabaseMentionReference[] | undefined
) {
  if (!references?.length) {
    return null
  }
  try {
    if (!record || !deps.validateDatabaseMentions) {
      throw new Error('Database references are unavailable on this host')
    }
    await deps.validateDatabaseMentions(record, references)
    return null
  } catch {
    return {
      ok: false as const,
      refusal: refuse(
        'agent_session_operation_invalid',
        { reason: 'requestMalformed' },
        'Select the database connection again: it changed or is unavailable in this project'
      )
    }
  }
}

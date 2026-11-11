import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { DatabaseCatalog } from '../../database/catalog/database-catalog'
import { requireDatabasePersistence } from './runtime-database-persistence'
import {
  resolveDatabaseProject,
  type DatabaseRuntimeHost,
  type DatabaseScope
} from './database-project-context'
import {
  resolveDatabaseMentions,
  type DatabaseMentionReference
} from '../../../shared/database/database-mention-reference'
export async function resolveRuntimeDatabaseMentions(
  runtime: DatabaseRuntimeHost,
  scope: DatabaseScope,
  references: readonly DatabaseMentionReference[]
) {
  const project = await resolveDatabaseProject(runtime, scope)
  const catalog = new DatabaseCatalog(requireDatabasePersistence(runtime.requireStore()))
  const available = catalog.list(project)
  return resolveDatabaseMentions(references, runtime.getRuntimeId(), (id) =>
    available.find((connection) => connection.id === id)
  )
}

export function runtimeDatabaseMentionValidator(runtime: DatabaseRuntimeHost) {
  return async (record: AgentSessionRecord, references: readonly DatabaseMentionReference[]) => {
    await resolveRuntimeDatabaseMentions(
      runtime,
      {
        worktree: `id:${record.location.workspaceId}`,
        executionHostId: record.location.executionHostId
      },
      references
    )
  }
}

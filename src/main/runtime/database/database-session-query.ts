import type { RpcContext } from '../rpc/core'
import type { DatabaseScope } from './database-project-context'
import { databaseActor, resolveDatabaseProject } from './database-project-context'
import { sameDatabaseProject } from '../../../shared/database/database-project-scope'
import { requireInstalledStructuredHost } from '../rpc/methods/structured-sessions/creation/structured-agent-session-gate'
import { runtimeDatabaseCommands } from './runtime-database-service-slot'
export async function databaseSessionQueryActor(
  context: RpcContext,
  params: DatabaseScope & { queryId: string; sessionId: string }
) {
  const caller = context.orchestrationCaller
  if (caller && (caller.kind === 'peer' || caller.sessionId !== params.sessionId)) {
    throw new Error('Calling agents may only read their own database queries')
  }
  const actor = await databaseActor(context, params)
  const host = await requireInstalledStructuredHost(context, params.sessionId)
  const record = host.deps.store.getRecord(params.sessionId)
  if (!record) {
    throw new Error('Database query session is unavailable')
  }
  const project = await resolveDatabaseProject(context.runtime, {
    worktree: `id:${record.location.workspaceId}`,
    executionHostId: record.location.executionHostId
  })
  if (!sameDatabaseProject(project, actor.project)) {
    throw new Error('Database query session is outside this project')
  }
  return { ...actor, owner: false, sessionId: params.sessionId }
}

export async function databaseSessionQuery(
  context: RpcContext,
  params: DatabaseScope & { queryId: string; sessionId: string }
) {
  const actor = await databaseSessionQueryActor(context, params)
  return (await runtimeDatabaseCommands(context.runtime)).queries.result(params.queryId, actor)
}

export async function databaseSessionQueryRecord(
  context: RpcContext,
  params: DatabaseScope & { queryId: string; sessionId: string }
) {
  const actor = await databaseSessionQueryActor(context, params)
  return (await runtimeDatabaseCommands(context.runtime)).queries.queryRecord(params.queryId, actor)
}

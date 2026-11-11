import type { DatabaseProjectKey } from '../../../shared/database/database-contracts'
import type { DatabaseQueryRecord } from '../../../shared/database/database-query-contracts'
import { sameDatabaseProject } from '../catalog/database-project-scope'

export type DatabaseActor = {
  controllerRuntimeId: string
  project: DatabaseProjectKey
  sessionId: string | null
  owner: boolean
  terminalHandle?: string
}

export function authorizeDatabaseQuery(
  record: DatabaseQueryRecord,
  actor: DatabaseActor,
  controllerRuntimeId: string
): void {
  if (
    actor.controllerRuntimeId !== controllerRuntimeId ||
    !sameDatabaseProject(record.project, actor.project) ||
    (!actor.owner && record.sessionId !== actor.sessionId)
  ) {
    throw new Error('Database query is unavailable in this session')
  }
}

export function readAuthorizedDatabaseQueryRecord(
  record: DatabaseQueryRecord | undefined,
  actor: DatabaseActor,
  controllerRuntimeId: string
): DatabaseQueryRecord {
  if (!record) {
    throw new Error('Database query was not found')
  }
  authorizeDatabaseQuery(record, actor, controllerRuntimeId)
  return structuredClone(record)
}

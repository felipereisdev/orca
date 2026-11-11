import type { DatabaseProjectKey } from '../../../shared/database/database-contracts'
import type { DatabaseQueryRecord } from '../../../shared/database/database-query-contracts'
import { sameDatabaseProject } from '../catalog/database-project-scope'

export type DatabaseActor = {
  controllerRuntimeId: string
  project: DatabaseProjectKey
  sessionId: string | null
  owner: boolean
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

import type { DatabaseProjectKey } from '../../../shared/database/database-contracts'

export function sameDatabaseProject(a: DatabaseProjectKey, b: DatabaseProjectKey): boolean {
  return a.kind === b.kind && a.projectId === b.projectId && a.executionHostId === b.executionHostId
}

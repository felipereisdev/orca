import type { DatabaseProjectKey } from './database-contracts'

export function sameDatabaseProject(a: DatabaseProjectKey, b: DatabaseProjectKey): boolean {
  return a.kind === b.kind && a.projectId === b.projectId && a.executionHostId === b.executionHostId
}

export function databaseProjectIdentityKey(project: DatabaseProjectKey): string {
  return JSON.stringify([project.kind, project.projectId, project.executionHostId])
}

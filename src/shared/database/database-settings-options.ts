import type { DatabaseEngine, DatabaseProjectKey } from './database-contracts'
import type { ExecutionHostId } from '../execution-host'

export type DatabaseHostCapabilities = {
  engines: DatabaseEngine[]
  protectedCredentialStorage: boolean
}
export type DatabaseProjectOption = {
  key: string
  project: DatabaseProjectKey
  label: string
  path: string
  badgeColor: string
}
export type DatabaseSettingsOptions = {
  projects: DatabaseProjectOption[]
  hosts: {
    executionHostId: ExecutionHostId
    label: string
    capabilities?: DatabaseHostCapabilities
  }[]
}

import type { DatabaseConnection } from './database-contracts'

export type DatabaseExecutionBinding = {
  principalId: string
  controllerRuntimeId: string
  connection: DatabaseConnection
}

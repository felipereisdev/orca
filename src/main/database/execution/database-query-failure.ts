import { DatabaseOperationError } from '../../../shared/database/database-operation-error'
import type { DatabaseQueryRecord } from '../../../shared/database/database-query-contracts'

export function databaseQueryFailure(
  error: unknown,
  phase: string
): NonNullable<DatabaseQueryRecord['error']> {
  return error instanceof DatabaseOperationError
    ? { code: error.code, message: error.message }
    : {
        code: `database_${phase}_failed`,
        message: `Database query could not complete its ${phase} step`
      }
}

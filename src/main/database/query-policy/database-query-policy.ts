import { parseSql } from '@orca/sql-read-query-parser'
import type { DatabaseEngine } from '../../../shared/database/database-contracts'
import { DatabaseQuerySyntax } from './database-query-syntax'
import { validatePostgresReadQuery } from './postgres-query-policy'
import { validateSqlServerReadQuery } from './sql-server-query-policy'
import { validateOracleReadQuery } from './oracle-query-policy'

const validated = Symbol('validated-database-read-query')

export type ValidatedDatabaseReadQuery = {
  readonly [validated]: true
  readonly engine: DatabaseEngine
  readonly sql: string
  readonly parameterNames: readonly string[]
}

export function validateDatabaseReadQuery(
  engine: DatabaseEngine,
  sql: string
): ValidatedDatabaseReadQuery {
  const query = new DatabaseQuerySyntax(parseSql(engine, sql))
  if (engine === 'postgres') {
    validatePostgresReadQuery(query)
  } else if (engine === 'sql-server') {
    validateSqlServerReadQuery(query)
  } else if (engine === 'oracle') {
    validateOracleReadQuery(query)
  } else {
    throw new Error('Unsupported database engine')
  }
  const parameterNames = query.syntax.tokens
    .filter(
      (token) =>
        (engine === 'postgres' && token.kind === 'PARAM') ||
        (engine === 'sql-server' && token.kind === 'LOCAL_ID') ||
        (engine === 'oracle' && token.kind === 'BINDVAR')
    )
    .map((token) => token.text.slice(1))
  return Object.freeze<ValidatedDatabaseReadQuery>({
    [validated]: true,
    engine,
    sql,
    parameterNames: Object.freeze([...new Set(parameterNames)])
  })
}

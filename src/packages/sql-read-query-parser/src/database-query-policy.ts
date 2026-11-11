import { parseSql } from './parse-sql'
export { tokenizeOracleStatement } from './parse-sql'
import type { SqlEngine as DatabaseEngine } from './parse-sql'
import { DatabaseQuerySyntax } from './database-query-syntax'
import { validatePostgresReadQuery } from './postgres-query-policy'
import { validateSqlServerReadQuery } from './sql-server-query-policy'
import { validateOracleReadQuery } from './oracle-query-policy'

const validated: unique symbol = Symbol('validated-database-read-query')

export type ValidatedDatabaseReadQuery = {
  readonly [validated]: true
  readonly engine: DatabaseEngine
  readonly sql: string
  readonly statementSql: string
  readonly oracleWithTokenCount: number
  readonly parameterNames: readonly string[]
  readonly statementTokens: readonly { text: string; parameterName?: string }[]
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
    statementSql:
      engine === 'postgres'
        ? query.syntax.tokens
            .slice(0, query.syntax.tokens.at(-1)?.text === ';' ? -1 : undefined)
            .map((token) => token.text)
            .join(' ')
        : sql,
    oracleWithTokenCount:
      engine === 'oracle'
        ? (() => {
            const clause = query
              .nodes('subquery')[0]
              ?.children.find((node) => node.rule === 'with_clause')
            return clause ? query.tokens(clause).length : 0
          })()
        : 0,
    statementTokens: Object.freeze(
      query.syntax.tokens.map((token) => ({
        text: token.text,
        ...(engine === 'oracle' && token.kind === 'BINDVAR'
          ? { parameterName: token.text.slice(1) }
          : {})
      }))
    ),
    parameterNames: Object.freeze([...new Set(parameterNames)])
  })
}

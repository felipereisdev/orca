import type { DatabaseQuerySyntax } from './database-query-syntax'

export function validateSqlServerReadQuery(query: DatabaseQuerySyntax): void {
  if (
    query.nodes('sql_clauses').length !== 1 ||
    query.nodes('select_statement_standalone').length !== 1
  ) {
    throw new Error('Submit one supported SQL Server read query')
  }
  query.refuseRules([
    'with_table_hints',
    'table_hint',
    'openquery',
    'openrowset',
    'opendatasource',
    'xml_data_type_methods',
    'hierarchyid_static_method',
    'partition_function',
    'freetext_function',
    'freetext_predicate',
    'execute_statement',
    'option_clause',
    'for_clause'
  ])
  query.refuseKeywords([
    'INTO',
    'INSERT',
    'UPDATE',
    'DELETE',
    'MERGE',
    'EXEC',
    'EXECUTE',
    'GO',
    'OPENROWSET',
    'OPENQUERY',
    'OPENDATASOURCE',
    'UPDLOCK',
    'XLOCK',
    'HOLDLOCK'
  ])
  query.requireLocalRelations('full_table_name')
  const allowed = new Set([
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'lower',
    'upper',
    'len',
    'abs',
    'round',
    'ceiling',
    'floor',
    'trim',
    'ltrim',
    'rtrim',
    'coalesce',
    'nullif',
    'isnull'
  ])
  for (const node of query.nodes('function_call')) {
    const tokens = query.tokens(node)
    if (!allowed.has(tokens[0]?.text.toLowerCase()) || tokens[1]?.text !== '(') {
      throw new Error('SQL function is outside the supported read-only subset')
    }
  }
  const tokens = query.syntax.tokens
  if (tokens.some((token, index) => token.kind === 'NEXT' && tokens[index + 1]?.kind === 'VALUE')) {
    throw new Error('Sequence advancement is not supported')
  }
}

import type { DatabaseQuerySyntax } from './database-query-syntax'

export function validateOracleReadQuery(query: DatabaseQuerySyntax): void {
  query.requireSingleSelect('sql_unit', 'data_manipulation_language_statements')
  if (
    query.nodes('data_manipulation_language_statements')[0]?.children[0]?.rule !==
    'select_statement'
  ) {
    throw new Error('Submit one supported Oracle read query')
  }
  query.refuseRules([
    'sql_plus_command',
    'plsql_unit',
    'into_clause',
    'for_update_clause',
    'dblink',
    'model_clause',
    'flashback_query_clause',
    'pivot_clause',
    'unpivot_clause',
    'type_spec'
  ])
  query.refuseKeywords(['INTO', 'FOR', 'AT_SIGN', 'DBLINK', 'NEW', 'CURSOR'])
  if (query.syntax.tokens.some((token) => /^(nextval|currval)$/i.test(token.text))) {
    throw new Error('Sequence access is not supported')
  }
  query.requireLocalRelations('tableview_name')
  const allowed = new Set([
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'lower',
    'upper',
    'length',
    'abs',
    'round',
    'ceil',
    'floor',
    'trim',
    'ltrim',
    'rtrim',
    'coalesce',
    'nullif',
    'nvl'
  ])
  for (const node of query.rules) {
    if (node.rule !== 'standard_function' && node.rule !== 'general_element') {
      continue
    }
    const tokens = query.tokens(node)
    const parenthesis = tokens.findIndex((token) => token.text === '(')
    if (parenthesis === -1) {
      continue
    }
    const name = tokens
      .slice(0, parenthesis)
      .map((token) => token.text)
      .join('')
      .toLowerCase()
    if (!allowed.has(name)) {
      throw new Error('SQL function is outside the supported read-only subset')
    }
  }
}

import type { DatabaseQuerySyntax } from './database-query-syntax'

export function validatePostgresReadQuery(query: DatabaseQuerySyntax): void {
  query.requireSingleSelect('stmt', 'selectstmt')
  for (const prepared of query.nodes('preparablestmt')) {
    if (prepared.children[0]?.rule !== 'selectstmt') {
      throw new Error('Writable CTEs are not supported')
    }
  }
  query.refuseRules([
    'into_clause',
    'locking_clause',
    'for_locking_clause',
    'func_table',
    'tablesample_clause',
    'typecast',
    'typename',
    'collate_clause'
  ])
  query.refuseKeywords(['INTO', 'FOR', 'OPERATOR', 'Operator', 'TYPECAST', 'COLLATE'])
  query.requireFunctions(
    'func_name',
    [
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
      'ceiling',
      'floor',
      'trim',
      'ltrim',
      'rtrim',
      'substring'
    ],
    'pg_catalog.'
  )
  query.requireLocalRelations('qualified_name')
  for (const node of query.nodes('func_expr_common_subexpr')) {
    const first = query.tokens(node)[0]?.kind
    if (first !== 'COALESCE' && first !== 'NULLIF') {
      throw new Error('SQL expression is outside the supported read-only subset')
    }
  }
}

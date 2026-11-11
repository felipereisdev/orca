import oracledb from 'oracledb'
import type { ValidatedDatabaseReadQuery } from '../query-policy/database-query-policy'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
export async function prepareOracleParameters(
  query: Pick<ValidatedDatabaseReadQuery, 'statementTokens' | 'oracleWithTokenCount'>,
  parameters: DatabaseParameter[],
  keepTerminator = false
) {
  const binds: oracledb.BindParameters = {}
  const replacements = new Map<string, string>()
  for (const parameter of parameters) {
    const name = parameter.name.toUpperCase()
    if (!/^[A-Z_][A-Z_0-9]{0,127}$/.test(name) || Object.hasOwn(binds, name)) {
      throw new Error('Oracle parameters require unique simple names')
    }
    const value = parameter.value
    let expression = `:${name}`
    let binding: oracledb.BindParameter = {
      val: value,
      type: oracledb.STRING,
      dir: oracledb.BIND_IN
    }
    if (parameter.type === 'integer' || parameter.type === 'decimal') {
      if (
        value !== null &&
        (!/^-?\d+(?:\.\d+)?$/.test(String(value)) ||
          (parameter.type === 'integer' && !/^-?\d+$/.test(String(value))) ||
          String(value).replace(/[-.]/g, '').replace(/^0+/, '').length > 38 ||
          (String(value).split('.')[1]?.length ?? 0) > 130)
      ) {
        throw new Error('Invalid Oracle numeric parameter')
      }
      expression = `TO_NUMBER(:${name})`
    }
    if (parameter.type === 'date') {
      if (value !== null) {
        const parts =
          /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
            String(value)
          )
        if (!parts) {
          throw new Error('Oracle dates require an ISO timestamp with an offset')
        }
        binding.val = `${parts[1]}.${(parts[2] ?? '').padEnd(9, '0')}${parts[3] === 'Z' ? '+00:00' : parts[3]}`
      }
      expression = `TO_TIMESTAMP_TZ(:${name}, 'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM')`
    }
    if (parameter.type === 'binary') {
      binding = {
        val: value === null ? null : Buffer.from(String(value), 'base64'),
        type: oracledb.BUFFER,
        dir: oracledb.BIND_IN
      }
    }
    if (parameter.type === 'boolean') {
      binding = { val: value, type: oracledb.DB_TYPE_BOOLEAN, dir: oracledb.BIND_IN }
    }
    binds[name] = binding
    replacements.set(name, expression)
  }
  const tokens = query.statementTokens
  const text = tokens
    .filter((token, index) => keepTerminator || token.text !== ';' || index !== tokens.length - 1)
    .map((token) =>
      token.parameterName !== undefined
        ? (replacements.get(token.parameterName.toUpperCase()) ?? token.text)
        : token.text
    )
  return {
    binds,
    statement: text.join(' '),
    withPrefix: query.oracleWithTokenCount
      ? text.slice(1, query.oracleWithTokenCount).join(' ')
      : '',
    body: text.slice(query.oracleWithTokenCount).join(' ')
  }
}

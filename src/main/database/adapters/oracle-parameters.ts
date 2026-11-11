import oracledb from 'oracledb'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
export async function prepareOracleParameters(statement: string, parameters: DatabaseParameter[]) {
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
      expression = `TO_TIMESTAMP_TZ(:${name}, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM')`
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
  const { parseSql } = await import('@orca/sql-read-query-parser')
  const tokens = parseSql('oracle', statement).tokens
  return {
    binds,
    statement: tokens
      .filter((token, index) => token.text !== ';' || index !== tokens.length - 1)
      .map((token) =>
        token.kind === 'BINDVAR'
          ? (replacements.get(token.text.slice(1).toUpperCase()) ?? token.text)
          : token.text
      )
      .join(' ')
  }
}

import sql from 'mssql'
import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'

export function prepareSqlServerParameters(parameters: DatabaseParameter[]) {
  const seen = new Set<string>()
  const types: string[] = []
  for (const parameter of parameters) {
    if (
      !/^[a-zA-Z_][a-zA-Z_0-9]{0,127}$/.test(parameter.name) ||
      seen.has(parameter.name.toLowerCase())
    ) {
      throw new Error('SQL Server parameters require unique simple names')
    }
    seen.add(parameter.name.toLowerCase())
    let type = 'nvarchar(max)'
    if (parameter.type === 'integer') {
      if (parameter.value !== null && !/^-?\d{1,19}$/.test(String(parameter.value))) {
        throw new Error('Invalid integer parameter')
      }
      type = 'bigint'
    }
    if (parameter.type === 'decimal') {
      const match =
        parameter.value === null ? null : /^-?(\d+)(?:\.(\d+))?$/.exec(String(parameter.value))
      if (
        parameter.value !== null &&
        (!match || match[1].replace(/^0+/, '').length + (match[2]?.length ?? 0) > 38)
      ) {
        throw new Error('Decimal parameter exceeds SQL Server precision')
      }
      type = `decimal(38,${match?.[2]?.length ?? 0})`
    }
    if (parameter.type === 'boolean') {
      type = 'bit'
    }
    if (parameter.type === 'date') {
      type = 'datetimeoffset(7)'
    }
    if (parameter.type === 'binary') {
      type = 'varbinary(max)'
    }
    types.push(type)
  }
  return {
    definitions: parameters
      .map((parameter, index) => `@${parameter.name} ${types[index]}`)
      .join(', '),
    namedDeclarations: parameters
      .map(
        (parameter, index) =>
          `DECLARE @${parameter.name} ${types[index]} = CONVERT(${types[index]}, @orca_v${index});`
      )
      .join('\n'),
    declarations: parameters
      .map(
        (_parameter, index) =>
          `DECLARE @orca_p${index} ${types[index]} = CONVERT(${types[index]}, @orca_v${index});`
      )
      .join('\n'),
    arguments: parameters.map((_parameter, index) => `@orca_p${index}`).join(', '),
    bind(request: sql.Request) {
      parameters.forEach((parameter, index) => {
        if (parameter.type === 'binary') {
          request.input(
            `orca_v${index}`,
            sql.VarBinary(sql.MAX),
            parameter.value === null ? null : Buffer.from(String(parameter.value), 'base64')
          )
        } else {
          request.input(
            `orca_v${index}`,
            sql.NVarChar(sql.MAX),
            parameter.value === null
              ? null
              : parameter.type === 'boolean'
                ? parameter.value
                  ? '1'
                  : '0'
                : String(parameter.value)
          )
        }
      })
    }
  }
}

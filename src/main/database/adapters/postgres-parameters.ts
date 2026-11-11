import type { DatabaseParameter } from '../../../shared/database/database-query-contracts'
export function bindPostgresParameters(parameters: DatabaseParameter[]): unknown[] {
  const positions = new Map<number, unknown>()
  for (const parameter of parameters) {
    const position = Number(parameter.name)
    if (
      !Number.isSafeInteger(position) ||
      position < 1 ||
      position > 256 ||
      positions.has(position)
    ) {
      throw new Error('PostgreSQL parameters require unique numeric positions')
    }
    positions.set(
      position,
      parameter.type === 'binary' && typeof parameter.value === 'string'
        ? Buffer.from(parameter.value, 'base64')
        : parameter.value
    )
  }
  const values: unknown[] = []
  for (let index = 1; index <= positions.size; index++) {
    if (!positions.has(index)) {
      throw new Error('PostgreSQL parameter positions must be contiguous')
    }
    values.push(positions.get(index))
  }
  return values
}

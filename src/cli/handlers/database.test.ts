import { PassThrough } from 'node:stream'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const call = vi.fn()
vi.mock('../runtime-client', async () => {
  const errors = await import('../runtime/types.js')
  return {
    ...errors,
    RuntimeClient: class {
      isRemote = false
      call = call
    }
  }
})
import { main } from '../index'
import { okFixture } from '../test-fixtures'

const source = {
  connectionId: '11111111-1111-4111-8111-111111111111',
  connectionRevision: 1,
  alias: 'faturacao-hmg',
  engine: 'postgres',
  environment: 'hmg',
  executionHostId: 'local',
  controllerRuntimeId: 'runtime-a'
}
const completed = {
  status: 'completed',
  record: { queryId: 'query-a', source },
  columns: [{ id: '0', name: 'amount', databaseType: 'numeric' }],
  rows: [['123456789012345678901.123456789']],
  rowCount: 1,
  truncated: false
}

beforeEach(() => {
  vi.restoreAllMocks()
  call.mockReset()
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
function stdin(text: string) {
  const input = new PassThrough()
  input.end(text)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: CLI input consumes only the readable stream API.
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin)
}

describe('database agent CLI', () => {
  it('prints the explicitly selected execution and preserves its ordered result from stdin SQL', async () => {
    stdin('SELECT amount FROM approved.invoices')
    call.mockImplementation(async (method, params) => {
      if (method === 'database.startQuery') {
        expect(params).toEqual({
          connection: 'faturacao-hmg',
          worktree: 'path:/tmp/project',
          sql: 'SELECT amount FROM approved.invoices',
          parameters: []
        })
        return okFixture('start', { queryId: 'query-a', source })
      }
      if (method === 'database.waitQuery' && params.queryId === 'query-a') {
        return okFixture('wait', completed)
      }
      throw new Error('Unexpected execution selector')
    })
    await main(
      ['db', 'query', '--connection', 'faturacao-hmg', '--sql-file', '-', '--json'],
      '/tmp/project'
    )
    expect(process.exitCode).toBeUndefined()
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).result).toEqual(
      completed
    )
  })

  it('supports an explicit folder project without Git cwd inference', async () => {
    call.mockImplementation(async (method, params) => {
      if (method !== 'database.list' || params.project !== 'folder-project') {
        throw new Error('Wrong project')
      }
      return okFixture('list', [{ ...source, alias: 'folder-hmg' }])
    })
    await main(['db', 'list', '--project', 'folder-project', '--json'], '/tmp/outside-git')
    expect(process.exitCode).toBeUndefined()
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).result[0].alias).toBe(
      'folder-hmg'
    )
  })

  it('reads bounded SQL and typed parameters from files and rejects an oversized SQL file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orca-database-cli-'))
    try {
      await writeFile(join(directory, 'query.sql'), 'SELECT $1')
      await writeFile(
        join(directory, 'parameters.json'),
        '[{"name":"1","type":"decimal","value":"123456789012345678901.123456789"}]'
      )
      call.mockImplementation(async (method, params) => {
        if (method === 'database.startQuery') {
          expect(params.sql).toBe('SELECT $1')
          expect(params.parameters).toEqual([
            { name: '1', type: 'decimal', value: '123456789012345678901.123456789' }
          ])
          return okFixture('start', { queryId: 'query-a', source })
        }
        return okFixture('wait', completed)
      })
      const args = [
        'db',
        'query',
        '--connection',
        'faturacao-hmg',
        '--sql-file',
        'query.sql',
        '--parameters-file',
        'parameters.json',
        '--json'
      ]
      await main(args, directory)
      expect(process.exitCode).toBeUndefined()
      await writeFile(join(directory, 'query.sql'), Buffer.alloc(65537, 'x'))
      await main(args, directory)
      expect(process.exitCode).toBe(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails for a missing connection or unknown alias and refuses competing stdin sources', async () => {
    for (const args of [
      ['--sql-file', '-'],
      ['--connection', 'unknown', '--sql-file', '-'],
      ['--connection', 'faturacao-hmg', '--sql-file', '-', '--parameters-file', '-']
    ]) {
      process.exitCode = undefined
      stdin('SELECT 1')
      call.mockRejectedValue(new Error('Unknown database connection'))
      await main(['db', 'query', ...args, '--json'], '/tmp/project')
      expect(process.exitCode).toBe(1)
    }
  })
})

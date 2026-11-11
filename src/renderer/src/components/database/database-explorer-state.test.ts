import { databaseQueryResultSchema } from '../../../../shared/database/database-query-result-schema'
import { expect, it } from 'vitest'
import { createDatabaseExplorerState } from './database-explorer-state'
import type { DatabaseQueryRecord } from '../../../../shared/database/database-query-contracts'

it('keeps execution provenance, selects the requested cached query and never reruns expired results', async () => {
  const record: DatabaseQueryRecord = {
    queryId: '11111111-1111-4111-8111-111111111112',
    source: {
      connectionId: '11111111-1111-4111-8111-111111111111',
      connectionRevision: 1,
      alias: 'billing-hmg',
      engine: 'postgres',
      environment: 'HMG',
      executionHostId: 'local',
      controllerRuntimeId: 'controller'
    },
    project: { kind: 'folder', projectId: 'crm', executionHostId: 'local' },
    sessionId: null,
    sql: 'SELECT 1',
    parameterNames: [],
    createdAt: 1000,
    finishedAt: 1100,
    status: 'completed',
    rowCount: 1,
    truncated: false
  }
  const explorer = createDatabaseExplorerState({
    connectionId: '11111111-1111-4111-8111-111111111111',
    controllerRuntimeId: 'controller'
  })
  await explorer.openQuery('11111111-1111-4111-8111-111111111113', async () => ({
    status: 'expired',
    record: { ...record, queryId: '11111111-1111-4111-8111-111111111113' }
  }))
  await explorer.openQuery('11111111-1111-4111-8111-111111111112', async () => ({
    status: 'completed',
    record,
    columns: [{ id: '0', name: 'n', databaseType: 'int4' }],
    rows: [['1']],
    rowCount: 1,
    truncated: false,
    limits: { timeoutMs: 30000, maxRows: 1000, maxOutputBytes: 5242880 }
  }))
  expect(databaseQueryResultSchema.safeParse(explorer.getSnapshot().result).success).toBe(true)
  explorer.selectConnection({ connectionId: 'prod', controllerRuntimeId: 'controller' })
  expect(explorer.getSnapshot().connection.connectionId).toBe('prod')
  expect(explorer.getSnapshot().result?.record.queryId).toBe('11111111-1111-4111-8111-111111111112')
  expect(explorer.getSnapshot().result?.record.source.environment).toBe('HMG')
  explorer.selectCell('11111111-1111-4111-8111-111111111112', 0, '0')
  await explorer.openQuery('11111111-1111-4111-8111-111111111113', async () => ({
    status: 'expired',
    record: { ...record, queryId: '11111111-1111-4111-8111-111111111113' }
  }))
  expect(explorer.getSnapshot().result?.status).toBe('expired')
  expect(explorer.getSnapshot().selection).toEqual([])
  explorer.selectCell('11111111-1111-4111-8111-111111111112', 0, '0')
  expect(explorer.getSnapshot().selection).toEqual([])
})

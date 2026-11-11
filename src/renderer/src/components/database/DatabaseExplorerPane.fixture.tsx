import { DatabaseSchemaTree } from './DatabaseSchemaTree'
import { useMemo } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { createDatabaseClientFixture } from '../settings/database/testing/database-client-fixture'
import { createDatabaseExplorerState } from './database-explorer-state'
import { DatabaseExplorerPane } from './DatabaseExplorerPane'
import type {
  DatabaseQueryRecord,
  DatabaseQuerySnapshot,
  ExpiredDatabaseResult
} from '../../../../shared/database/database-query-contracts'
function Preview({ expired = false }: { expired?: boolean }) {
  const { client, controller } = useMemo(() => {
    const fixture = createDatabaseClientFixture()
    const source = {
      connectionId: fixture.state.configuration.id,
      connectionRevision: 1,
      alias: 'faturacao-hmg',
      engine: 'postgres' as const,
      environment: 'HMG',
      executionHostId: 'local' as const,
      controllerRuntimeId: 'fixture-controller'
    }
    const record: DatabaseQueryRecord = {
      queryId: '11111111-1111-4111-8111-111111111112',
      source,
      project: fixture.options.projects[0].project,
      sessionId: null,
      sql: 'SELECT id, nome, saldo FROM public.clientes LIMIT 100',
      parameterNames: [],
      createdAt: 1794391200000,
      finishedAt: 1794391200120,
      status: 'completed',
      rowCount: 3,
      truncated: true
    }
    const result: DatabaseQuerySnapshot | ExpiredDatabaseResult = expired
      ? { status: 'expired', record }
      : {
          status: 'completed',
          record,
          columns: [
            { id: '0', name: 'id', databaseType: 'int4' },
            { id: '1', name: 'nome', databaseType: 'text' },
            { id: '2', name: 'saldo', databaseType: 'numeric' }
          ],
          rows: [
            ['1', 'Ana Costa', '1420.50'],
            ['2', 'Miguel Santos', null],
            ['3', 'Sofia Martins', '9007199254740993.25']
          ],
          rowCount: 3,
          truncated: true,
          limits: fixture.state.configuration.limits
        }
    fixture.client.status = async () => ({
      runtimeId: 'fixture-controller',
      rendererGraphEpoch: 1,
      graphStatus: 'ready',
      authoritativeWindowId: null,
      liveTabCount: 0,
      liveLeafCount: 0
    })
    fixture.client.list = async () => [fixture.state.configuration]
    fixture.client.describe = async (_scope, _connection, schema, table) => ({
      schemas: ['public'],
      tables: schema
        ? [
            { schema: 'public', name: 'clientes', kind: 'table' },
            { schema: 'public', name: 'faturas', kind: 'table' },
            { schema: 'public', name: 'resumo', kind: 'view' }
          ]
        : [],
      columns: table
        ? [
            { name: 'id', databaseType: 'integer', primaryKey: true, nullable: false },
            { name: 'nome', databaseType: 'text', primaryKey: false, nullable: false },
            { name: 'saldo', databaseType: 'numeric', primaryKey: false, nullable: true }
          ]
        : [],
      truncated: false
    })
    fixture.client.result = async () => result
    const controller = createDatabaseExplorerState({
      connectionId: source.connectionId,
      controllerRuntimeId: source.controllerRuntimeId
    })
    controller.edit(record.sql)
    void controller.openQuery(record.queryId, async () => result)
    return { client: fixture.client, controller }
  }, [expired])
  return (
    <div className="h-[720px]">
      <DatabaseExplorerPane
        client={client}
        controller={controller}
        worktreeId="billing::/work/billing"
      />
    </div>
  )
}
export const results = defineFixture({
  width: 1200,
  render: () => <Preview />,
  interact: (frame) => {
    ;[...frame.querySelectorAll('button')]
      .find((element) => element.textContent === 'public')
      ?.click()
  }
})
export const expired = defineFixture({ width: 1200, render: () => <Preview expired /> })
export const narrow = defineFixture({
  width: 390,
  render: () => <Preview />,
  interact: (frame) => {
    frame.querySelector<HTMLButtonElement>('button[aria-label="Toggle schema browser"]')?.click()
  }
})

export const schema = defineFixture({
  width: 256,
  render: () => (
    <div className="h-[520px] bg-background text-foreground">
      <DatabaseSchemaTree
        value={{
          schemas: ['public'],
          tables: [
            { schema: 'public', name: 'clientes', kind: 'table' },
            { schema: 'public', name: 'resumo_faturas', kind: 'view' }
          ],
          columns: [
            { name: 'id', databaseType: 'integer', primaryKey: true, nullable: false },
            { name: 'nome', databaseType: 'text', primaryKey: false, nullable: false },
            { name: 'saldo', databaseType: 'numeric', primaryKey: false, nullable: true }
          ],
          truncated: false
        }}
        table={{ schema: 'public', name: 'clientes', kind: 'table' }}
        loading={false}
        error={null}
        onSchema={() => {}}
        onTable={() => {}}
        onPreview={() => {}}
        onAdd={() => {}}
      />
    </div>
  )
})

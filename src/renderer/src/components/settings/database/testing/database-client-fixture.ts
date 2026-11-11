import {
  createDatabaseRuntimeClient,
  type DatabaseRuntimeClient
} from '@/runtime/database/database-runtime-client'
import type { DatabaseConnectionConfiguration } from '../../../../../../shared/database/database-contracts'
import type {
  DatabaseSettingsOptions,
  DatabaseHostCapabilities
} from '../../../../../../shared/database/database-settings-options'
import { databaseProjectIdentityKey } from '../../../../../../shared/database/database-project-scope'

export function createDatabaseClientFixture() {
  const options: DatabaseSettingsOptions = {
    projects: [
      {
        key: 'billing',
        project: { kind: 'repository', projectId: 'billing', executionHostId: 'local' },
        label: 'Faturação',
        path: '/work/billing',
        badgeColor: ''
      },
      {
        key: 'crm',
        project: { kind: 'folder', projectId: 'crm', executionHostId: 'local' },
        label: 'CRM',
        path: '/work/crm',
        badgeColor: ''
      }
    ],
    hosts: [
      {
        executionHostId: 'local',
        label: 'Local',
        capabilities: {
          engines: ['postgres', 'sql-server', 'oracle'],
          protectedCredentialStorage: true
        }
      },
      { executionHostId: 'runtime:gateway', label: 'db-gateway' }
    ]
  }
  for (const project of options.projects) {
    project.key = databaseProjectIdentityKey(project.project)
  }
  const state: { configuration: DatabaseConnectionConfiguration } = {
    configuration: {
      id: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      alias: 'faturacao-hmg',
      displayName: 'Faturação',
      engine: 'postgres',
      environment: 'HMG',
      executionHostId: 'local',
      projects: [options.projects[0].project],
      endpoint: { server: 'original-db', port: 5432, database: 'billing', tls: { enabled: true } },
      limits: { timeoutMs: 30000, maxRows: 1000, maxOutputBytes: 5242880 },
      credentialConfigured: true
    }
  }
  const client: DatabaseRuntimeClient = {
    ...createDatabaseRuntimeClient({ kind: 'local' }),
    settingsOptions: async () => options,
    hostCapabilities: async (): Promise<DatabaseHostCapabilities> => ({
      engines: ['postgres', 'sql-server', 'oracle'],
      protectedCredentialStorage: true
    }),
    catalog: async () => [structuredClone(state.configuration)],
    configuration: async () => structuredClone(state.configuration),
    save: async (
      input: Parameters<ReturnType<typeof createDatabaseRuntimeClient>['save']>[0],
      _credentials: unknown,
      revision?: number
    ) => {
      if (revision !== state.configuration.revision) {
        throw new Error('Connection changed; reload before saving')
      }
      state.configuration = {
        ...input,
        id: state.configuration.id,
        revision: revision + 1,
        limits: state.configuration.limits,
        credentialConfigured: true
      }
      return structuredClone(state.configuration)
    },
    test: async () => ({ serverVersion: 'PostgreSQL 16', readOnlyProfile: true })
  }
  return { client, options, state }
}

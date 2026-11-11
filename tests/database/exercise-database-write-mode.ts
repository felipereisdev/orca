import { expect } from 'vitest'
import type { DatabaseAdapter } from '../../src/main/database/adapters/database-adapter'
import type {
  DatabaseConnection,
  DatabaseCredentials
} from '../../src/shared/database/database-contracts'
import { DatabaseCatalog } from '../../src/main/database/catalog/database-catalog'
import { DatabaseCredentialStore } from '../../src/main/database/credentials/database-credential-store'
import { createDatabaseTestProfile } from '../../src/main/database/catalog/testing/database-profile-fixture'
import { DatabaseQueryService } from '../../src/main/database/execution/database-query-service'

export async function exerciseDatabaseWriteMode(
  adapter: DatabaseAdapter,
  configuration: DatabaseConnection,
  credentials: DatabaseCredentials,
  reader: DatabaseCredentials,
  placeholder: string,
  routine: string
) {
  const profile = createDatabaseTestProfile()
  const catalog = new DatabaseCatalog(profile.store)
  const secrets = new DatabaseCredentialStore(profile.store)
  const project = {
    kind: 'folder' as const,
    projectId: 'write-fixture',
    executionHostId: 'local' as const
  }
  const actor = {
    controllerRuntimeId: 'write-test',
    project,
    sessionId: 'write-test',
    owner: false
  }
  const service = new DatabaseQueryService({
    store: profile.store,
    catalog,
    credentials: secrets,
    controllerRuntimeId: 'write-test',
    executionHostId: 'local',
    adapter: () => adapter
  })
  const credentialRef = await secrets.enroll(configuration.id, credentials)
  let saved = await catalog.save({ ...configuration, projects: [project], credentialRef })
  const run = async (
    sql: string,
    parameters: Parameters<typeof service.start>[0]['parameters'] = []
  ) => {
    const handle = await service.start({ connection: saved.id, project, sql, parameters }, actor)
    return service.wait(handle.queryId, actor, AbortSignal.timeout(20000))
  }
  try {
    expect(
      (
        await run(
          'CREATE TABLE approved.orca_write_test (id integer PRIMARY KEY, label varchar(40))'
        )
      ).status
    ).toBe('failed')
    saved = await catalog.save({ ...saved, accessMode: 'read-write' }, saved.revision)
    expect(catalog.getConfiguration(saved.id)).toMatchObject({ accessMode: 'read-write' })
    expect(
      (await adapter.preflight(saved, credentials, AbortSignal.timeout(10000))).readOnlyProfile
    ).toBe(false)
    expect(
      (
        await run(
          'CREATE TABLE approved.orca_write_test (id integer PRIMARY KEY, label varchar(40))'
        )
      ).status
    ).toBe('completed')
    const inserted = await run(
      `INSERT INTO approved.orca_write_test (id, label) VALUES (1, ${placeholder})`,
      [
        {
          name: configuration.engine === 'postgres' ? '1' : 'label',
          type: 'string',
          value: "bound ' value"
        }
      ]
    )
    expect(inserted).toMatchObject({ status: 'completed', record: { affectedRows: 1 } })
    const updated = await run("UPDATE approved.orca_write_test SET label = 'changed' WHERE id = 1")
    expect(updated).toMatchObject({ status: 'completed', record: { affectedRows: 1 } })
    expect(await run('SELECT label FROM approved.orca_write_test')).toMatchObject({
      status: 'completed',
      rows: [['changed']]
    })
    expect((await run('ALTER TABLE approved.orca_write_test ADD extra integer')).status).toBe(
      'completed'
    )
    if (configuration.engine === 'postgres') {
      expect(await run('SELECT 1 AS first WHERE false; SELECT 2 AS second')).toMatchObject({
        status: 'completed',
        columns: [{ name: 'first' }],
        rows: [],
        truncated: true
      })
    } else {
      const temporal =
        configuration.engine === 'sql-server'
          ? "SELECT CAST('2026-11-11T12:34:56.1234567' AS datetime2(7)) AS exact_time"
          : "SELECT TIMESTAMP '2026-11-11 12:34:56.123456789' AS exact_time FROM dual"
      expect(await run(temporal)).toMatchObject({
        status: 'completed',
        truncated: true,
        rows: [[{ kind: 'preview', truncated: true }]]
      })
    }
    const routineResult = await run(routine)
    expect(routineResult.status).toBe('completed')
    if (configuration.engine !== 'postgres') {
      expect(routineResult).toMatchObject({ rows: [['routine']] })
    }
    if (configuration.engine !== 'oracle') {
      saved = await catalog.save(
        { ...saved, limits: { ...saved.limits, maxRows: 1 } },
        saved.revision
      )
      const bounded = await run(
        "SELECT label FROM approved.orca_write_test UNION ALL SELECT label FROM approved.orca_write_test; INSERT INTO approved.orca_write_test (id, label) VALUES (2, 'after-preview')"
      )
      expect(bounded).toMatchObject({ status: 'completed', rowCount: 1, truncated: true })
      expect(await run('SELECT label FROM approved.orca_write_test WHERE id = 2')).toMatchObject({
        status: 'completed',
        rows: [['after-preview']]
      })
      expect((await run('DELETE FROM approved.orca_write_test WHERE id = 2')).status).toBe(
        'completed'
      )
    }
    expect(await run('DELETE FROM approved.orca_write_test WHERE id = 1')).toMatchObject({
      status: 'completed',
      record: { affectedRows: 1 }
    })
    expect((await run('DROP TABLE approved.orca_write_test')).status).toBe('completed')
    saved = await catalog.save({ ...saved, accessMode: 'read-only' }, saved.revision)
    expect((await run('CREATE TABLE approved.orca_write_denied (id integer)')).status).toBe(
      'failed'
    )
    const readerRef = await secrets.enroll(configuration.id, reader)
    saved = await catalog.save(
      { ...saved, credentialRef: readerRef, accessMode: 'read-write' },
      saved.revision
    )
    expect((await run('CREATE TABLE approved.orca_write_denied (id integer)')).status).toBe(
      'failed'
    )
  } finally {
    await service.dispose()
    await profile.close()
  }
}

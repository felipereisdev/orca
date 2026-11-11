import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sql from 'mssql'
import { runProcess } from '@orca/process-host'
import type { DatabaseConnection } from '../../src/shared/database/database-contracts'
import { createDatabaseTlsFixture } from './database-tls-fixture'
import { runDatabaseFixtureProcess as command } from './database-fixture-process'
export async function createSqlServerFixture() {
  const tls = await createDatabaseTlsFixture('sql-server')
  const name = `orca-database-${randomUUID()}`
  const adminCredentials = { username: 'sa', password: 'Disposable-admin-password-178!' }
  const credentials = { username: 'orca_reader', password: 'Disposable-reader-password-178!' }
  const pools = new Set<sql.ConnectionPool>()
  const close = async () => {
    await Promise.allSettled([...pools].map((pool) => pool.close()))
    await runProcess({ program: 'docker', args: ['rm', '-f', name], timeoutMs: 15000 })
    await tls.close()
  }
  try {
    await writeFile(
      join(tls.directory, 'mssql.conf'),
      '[network]\ntlscert = /var/opt/mssql/server.crt\ntlskey = /var/opt/mssql/server.key\ntlsprotocols = 1.2\nforceencryption = 1\n'
    )
    await command('docker', [
      'run',
      '-d',
      '--platform=linux/amd64',
      '--user',
      '0',
      '--name',
      name,
      '-p',
      '127.0.0.1::1433',
      '-e',
      'ACCEPT_EULA=Y',
      '-e',
      `MSSQL_SA_PASSWORD=${adminCredentials.password}`,
      '-e',
      'MSSQL_PID=Developer',
      '-e',
      'MSSQL_MEMORY_LIMIT_MB=1536',
      '--mount',
      `type=bind,source=${tls.directory},target=/fixtures,readonly`,
      '--entrypoint',
      '/bin/bash',
      'mcr.microsoft.com/mssql/server:2022-CU18-ubuntu-22.04',
      '-c',
      'cp /fixtures/server.key /fixtures/server.crt /fixtures/mssql.conf /var/opt/mssql/ && chown mssql:root /var/opt/mssql/server.key /var/opt/mssql/server.crt /var/opt/mssql/mssql.conf && chmod 600 /var/opt/mssql/server.key && exec runuser -u mssql -- /opt/mssql/bin/sqlservr'
    ])
    const port = Number((await command('docker', ['port', name, '1433/tcp'])).split(':').at(-1))
    const connect = async (
      user = adminCredentials.username,
      password = adminCredentials.password,
      database = 'master'
    ) => {
      const pool = new sql.ConnectionPool({
        server: '127.0.0.1',
        port,
        database,
        user,
        password,
        connectionTimeout: 2000,
        requestTimeout: 10000,
        pool: { min: 0, max: 1 },
        options: {
          encrypt: true,
          trustServerCertificate: false,
          serverName: 'localhost',
          cryptoCredentialsDetails: { ca: tls.certificate },
          appName: 'orca-database-fixture',
          useUTC: true
        }
      })
      pool.on('error', () => {})
      pools.add(pool)
      try {
        await pool.connect()
        return pool
      } catch (error) {
        pools.delete(pool)
        await pool.close().catch(() => {})
        throw error
      }
    }
    let bootstrap: sql.ConnectionPool | undefined
    const readyBy = Date.now() + 100000
    while (!bootstrap) {
      try {
        bootstrap = await connect()
      } catch (error) {
        if (Date.now() >= readyBy) {
          const logs = await command('docker', ['logs', '--tail', '35', name])
          throw new Error(`SQL Server fixture did not start: ${logs}`, { cause: error })
        }
      }
    }
    await bootstrap.request().query('CREATE DATABASE fixture')
    await bootstrap.close()
    pools.delete(bootstrap)
    const adminPool = await connect(adminCredentials.username, adminCredentials.password, 'fixture')
    await adminPool.request().batch(`
      CREATE LOGIN orca_reader WITH PASSWORD = '${credentials.password}', CHECK_POLICY = OFF;
      CREATE USER orca_reader FOR LOGIN orca_reader;
    `)
    await adminPool.request().query('CREATE SCHEMA approved')
    await adminPool.request().batch(`
      CREATE TABLE approved.invoices (id bigint PRIMARY KEY, amount numeric(30,9), memo nvarchar(max));
      INSERT INTO approved.invoices VALUES (9007199254740993, 123456789012345678901.123456789, NULL), (2, 0.000000001, N'');
      CREATE TABLE approved.large_values (memo nvarchar(max));
      INSERT INTO approved.large_values VALUES (REPLICATE(CAST(N'x' AS nvarchar(max)), 2000000));
      CREATE TABLE approved.blocked (id int NOT NULL);
      INSERT INTO approved.blocked VALUES (7);
      GRANT SELECT ON SCHEMA::approved TO orca_reader;
      GRANT VIEW DEFINITION TO orca_reader;
    `)
    const readerPool = await connect(credentials.username, credentials.password, 'fixture')
    const configuration: DatabaseConnection = {
      id: randomUUID(),
      revision: 1,
      alias: 'fixture-hmg',
      displayName: 'Disposable SQL Server',
      engine: 'sql-server',
      environment: 'hmg',
      executionHostId: 'local',
      projects: [],
      limits: { timeoutMs: 10000, maxRows: 1000, maxOutputBytes: 5242880 },
      endpoint: {
        server: '127.0.0.1',
        port,
        database: 'fixture',
        tls: { enabled: true, caCertificate: tls.certificate, serverName: 'localhost' }
      },
      credentialRef: 'fixture-only'
    }
    const activeReaders = async () =>
      (
        await adminPool
          .request()
          .query<{ active: number }>(
            `SELECT COUNT(*) AS active FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id WHERE s.program_name = N'orca-read-only'`
          )
      ).recordset[0].active
    return {
      configuration,
      credentials,
      adminCredentials,
      admin: (text: string) => adminPool.request().query(text),
      reader: (text: string) => readerPool.request().query(text),
      close,
      lock: async () => {
        const lockPool = await connect(
          adminCredentials.username,
          adminCredentials.password,
          'fixture'
        )
        const transaction = new sql.Transaction(lockPool)
        await transaction.begin()
        await new sql.Request(transaction).query('UPDATE approved.blocked SET id = id + 1')
        return async () => {
          await transaction.rollback()
          await lockPool.close()
          pools.delete(lockPool)
        }
      },
      activeReaders,
      waitForBlockedReader: async () => {
        const deadline = Date.now() + 10000
        for (;;) {
          const count = (
            await adminPool
              .request()
              .query<{ blocked: number }>(
                `SELECT COUNT(*) AS blocked FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id WHERE s.program_name = N'orca-read-only' AND r.blocking_session_id > 0`
              )
          ).recordset[0].blocked
          if (count) {
            return
          }
          if (Date.now() >= deadline) {
            throw new Error('SQL Server fixture reader did not block')
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 20))
        }
      }
    }
  } catch (error) {
    await close()
    throw error
  }
}

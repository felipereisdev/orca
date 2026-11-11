import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import oracledb from 'oracledb'
import { runProcess } from '@orca/process-host'
import type { DatabaseConnection } from '../../src/shared/database/database-contracts'
import { createDatabaseTlsFixture } from './database-tls-fixture'
import { runDatabaseFixtureProcess as command } from './database-fixture-process'

export async function createOracleFixture() {
  const tls = await createDatabaseTlsFixture('oracle')
  const name = `orca-database-${randomUUID()}`
  const credentials = { username: 'ORCA_READER', password: 'Disposable-reader-password-178' }
  const adminCredentials = { username: 'SYSTEM', password: 'Disposable-admin-password-178' }
  let admin: oracledb.Connection | undefined
  const close = async () => {
    await admin?.close().catch(() => {})
    await runProcess({ program: 'docker', args: ['rm', '-f', name], timeoutMs: 15000 })
    await tls.close()
  }
  try {
    await command('openssl', [
      'pkcs12',
      '-export',
      '-inkey',
      join(tls.directory, 'server.key'),
      '-in',
      join(tls.directory, 'server.crt'),
      '-out',
      join(tls.directory, 'server.p12'),
      '-passout',
      'pass:Fixture-wallet-password-178'
    ])
    await command('docker', [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      '127.0.0.1::1521',
      '-p',
      '127.0.0.1::2484',
      '-e',
      `ORACLE_PASSWORD=${adminCredentials.password}`,
      '--mount',
      `type=bind,source=${tls.directory},target=/fixtures,readonly`,
      'gvenzl/oracle-free:23-full'
    ])
    const tcpPort = Number((await command('docker', ['port', name, '1521/tcp'])).split(':').at(-1))
    const port = Number((await command('docker', ['port', name, '2484/tcp'])).split(':').at(-1))
    const readyBy = Date.now() + 180000
    while (!admin) {
      try {
        admin = await oracledb.getConnection({
          user: adminCredentials.username,
          password: adminCredentials.password,
          connectString: `127.0.0.1:${tcpPort}/FREEPDB1?connect_timeout=2&transport_connect_timeout=2&retry_count=0`
        })
      } catch (error) {
        if (Date.now() >= readyBy) {
          const logs = await command('docker', ['logs', '--tail', '25', name])
          throw new Error(`Oracle fixture did not start: ${logs}`, { cause: error })
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
      }
    }
    await command('docker', [
      'exec',
      '-u',
      '0',
      name,
      '/bin/bash',
      '-c',
      'mkdir -p /tmp/orca-wallet && cp /fixtures/server.p12 /tmp/orca-wallet/server.p12 && chown -R oracle:oinstall /tmp/orca-wallet && chmod 700 /tmp/orca-wallet'
    ])
    await command('docker', [
      'exec',
      name,
      'orapki',
      'wallet',
      'create',
      '-wallet',
      '/tmp/orca-wallet',
      '-pwd',
      'Fixture-wallet-password-178',
      '-auto_login'
    ])
    await command('docker', [
      'exec',
      name,
      'orapki',
      'wallet',
      'import_pkcs12',
      '-wallet',
      '/tmp/orca-wallet',
      '-pwd',
      'Fixture-wallet-password-178',
      '-pkcs12file',
      '/tmp/orca-wallet/server.p12',
      '-pkcs12pwd',
      'Fixture-wallet-password-178'
    ])
    await command('docker', [
      'exec',
      name,
      '/bin/bash',
      '-c',
      `cat > "$ORACLE_HOME/network/admin/listener.ora" <<'LISTENER'
LISTENER=(DESCRIPTION_LIST=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=0.0.0.0)(PORT=1521))(ADDRESS=(PROTOCOL=TCPS)(HOST=0.0.0.0)(PORT=2484))))
DEFAULT_SERVICE_LISTENER=FREE
WALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/tmp/orca-wallet)))
SSL_CLIENT_AUTHENTICATION=FALSE
LISTENER
cat >> "$ORACLE_HOME/network/admin/sqlnet.ora" <<'SQLNET'
WALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/tmp/orca-wallet)))
SSL_CLIENT_AUTHENTICATION=FALSE
SQLNET
lsnrctl stop && lsnrctl start`
    ])
    await admin.execute('ALTER SYSTEM REGISTER')
    console.info('Disposable Oracle server:', admin.oracleServerVersionString)
    for (const statement of [
      `CREATE USER approved IDENTIFIED BY "Disposable-owner-password-178" QUOTA 30M ON USERS`,
      `CREATE USER orca_reader IDENTIFIED BY "${credentials.password}"`,
      'GRANT CREATE SESSION TO orca_reader',
      'CREATE TABLE approved.invoices (id NUMBER(19) PRIMARY KEY, amount NUMBER(30,9), memo VARCHAR2(100))',
      'INSERT INTO approved.invoices VALUES (9007199254740993,123456789012345678901.123456789,NULL)',
      "INSERT INTO approved.invoices VALUES (2,0.000000001,'')",
      'CREATE TABLE approved.large_values (memo CLOB)',
      "DECLARE value CLOB; BEGIN INSERT INTO approved.large_values VALUES (EMPTY_CLOB()) RETURNING memo INTO value; FOR i IN 1..200 LOOP DBMS_LOB.WRITEAPPEND(value,10000,RPAD('x',10000,'x')); END LOOP; END;",
      'CREATE TABLE approved.load (id NUMBER)',
      'INSERT INTO approved.load SELECT LEVEL FROM dual CONNECT BY LEVEL <= 1000',
      'GRANT SELECT ON approved.invoices TO orca_reader',
      'GRANT SELECT ON approved.large_values TO orca_reader',
      'GRANT SELECT ON approved.load TO orca_reader'
    ]) {
      await admin.execute(statement)
    }
    await admin.commit()
    const configuration: DatabaseConnection = {
      id: randomUUID(),
      revision: 1,
      alias: 'fixture-hmg',
      displayName: 'Disposable Oracle',
      engine: 'oracle',
      environment: 'hmg',
      executionHostId: 'local',
      projects: [],
      limits: { timeoutMs: 10000, maxRows: 1000, maxOutputBytes: 5242880 },
      endpoint: {
        server: '127.0.0.1',
        port,
        database: 'FREEPDB1',
        tls: { enabled: true, caCertificate: tls.certificate }
      },
      credentialRef: 'fixture-only'
    }
    const activeReaders = async () =>
      (
        await admin!.execute<[number]>(
          "SELECT COUNT(*) FROM v$session WHERE username='ORCA_READER' AND module='orca-read-only' AND status='ACTIVE' AND sql_id IS NOT NULL"
        )
      ).rows![0][0]
    return {
      configuration,
      credentials,
      adminCredentials,
      admin,
      close,
      activeReaders,
      waitForExecutingReader: async () => {
        const deadline = Date.now() + 10000
        for (;;) {
          const active = await admin!.execute<[number]>(
            "SELECT COUNT(*) FROM v$session s JOIN v$sql q ON q.sql_id=s.sql_id AND q.child_number=s.sql_child_number WHERE s.username='ORCA_READER' AND s.module='orca-read-only' AND s.status='ACTIVE' AND UPPER(q.sql_text) LIKE 'SELECT COUNT%APPROVED%LOAD%'"
          )
          if (active.rows![0][0]) {
            return
          }
          if (Date.now() >= deadline) {
            throw new Error('Oracle fixture reader did not execute')
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

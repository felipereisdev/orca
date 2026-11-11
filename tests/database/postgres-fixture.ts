import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { Client, type ClientConfig } from 'pg'
import type { DatabaseConnection } from '../../src/shared/database/database-contracts'

export async function createPostgresFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'orca-database-postgres-'))
  const name = `orca-database-${randomUUID()}`
  const command = async (program: string, args: string[]) => {
    const result = await runProcess({ program, args, timeoutMs: 30_000 })
    if (result.code !== 0) {
      throw new Error(`${program} fixture failed: ${result.stderr}`)
    }
    return result.stdout.trim()
  }
  const close = async () => {
    await runProcess({ program: 'docker', args: ['rm', '-f', name], timeoutMs: 15_000 })
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await command('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      join(directory, 'server.key'),
      '-out',
      join(directory, 'server.crt')
    ])
    await command('docker', [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_PASSWORD=disposable-admin-password',
      '-e',
      'POSTGRES_DB=fixture',
      '--mount',
      `type=bind,source=${directory},target=/fixtures,readonly`,
      'postgres:16-alpine',
      'sh',
      '-c',
      'cp /fixtures/server.key /tmp/server.key && chown postgres:postgres /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/fixtures/server.crt -c ssl_key_file=/tmp/server.key'
    ])
    const port = Number((await command('docker', ['port', name, '5432/tcp'])).split(':').at(-1))
    const ca = await readFile(join(directory, 'server.crt'), 'utf8')
    const adminConfig: ClientConfig = {
      host: '127.0.0.1',
      port,
      database: 'fixture',
      user: 'postgres',
      password: 'disposable-admin-password',
      ssl: { ca, rejectUnauthorized: true },
      connectionTimeoutMillis: 1000
    }
    const readyDeadline = Date.now() + 25_000
    let admin: Client | undefined
    while (!admin) {
      const candidate = new Client(adminConfig)
      candidate.on('error', () => {})
      try {
        await candidate.connect()
        admin = candidate
      } catch (error) {
        await candidate.end().catch(() => {})
        if (Date.now() >= readyDeadline) {
          throw error
        }
      }
    }
    await admin.query(`
      REVOKE CREATE, TEMPORARY ON DATABASE fixture FROM PUBLIC;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE ROLE orca_reader LOGIN PASSWORD 'disposable-reader-password' NOINHERIT;
      CREATE SCHEMA approved;
      CREATE TABLE approved.invoices (id bigint PRIMARY KEY, amount numeric(30,9), memo text);
      INSERT INTO approved.invoices VALUES
        (9007199254740993, 123456789012345678901.123456789, NULL), (2, 0.000000001, '');
      CREATE TABLE approved.blocked (id int);
      INSERT INTO approved.blocked VALUES (7);
      CREATE TABLE approved.effects (id int);
      CREATE VIEW approved.invoice_totals WITH (security_invoker=true) AS
        SELECT id, amount FROM approved.invoices;
      CREATE FUNCTION approved.side_effect() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS
        'BEGIN INSERT INTO approved.effects VALUES (1); RETURN 1; END';
      REVOKE ALL ON FUNCTION approved.side_effect() FROM PUBLIC;
      GRANT USAGE ON SCHEMA approved TO orca_reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA approved TO orca_reader;
    `)
    const configuration: DatabaseConnection = {
      id: randomUUID(),
      revision: 1,
      alias: 'fixture-hmg',
      displayName: 'Disposable fixture',
      engine: 'postgres',
      environment: 'hmg',
      executionHostId: 'local',
      projects: [],
      limits: { timeoutMs: 5000, maxRows: 1000, maxOutputBytes: 5 * 1024 * 1024 },
      endpoint: {
        server: '127.0.0.1',
        port,
        database: 'fixture',
        tls: { enabled: true, caCertificate: ca }
      },
      credentialRef: 'fixture-only'
    }
    return {
      configuration,
      admin,
      credentials: { username: 'orca_reader', password: 'disposable-reader-password' },
      close: async () => {
        await admin.end()
        await close()
      }
    }
  } catch (error) {
    await close()
    throw error
  }
}

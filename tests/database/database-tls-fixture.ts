import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDatabaseFixtureProcess } from './database-fixture-process'
export async function createDatabaseTlsFixture(engine: string) {
  const directory = await mkdtemp(join(tmpdir(), `orca-database-${engine}-`))
  try {
    await runDatabaseFixtureProcess('openssl', [
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
    return {
      directory,
      certificate: await readFile(join(directory, 'server.crt'), 'utf8'),
      close: () => rm(directory, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

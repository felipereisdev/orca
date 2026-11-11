import { Client, type ClientConfig } from 'pg'
import type {
  DatabaseConnection,
  DatabaseCredentials
} from '../../../shared/database/database-contracts'

function clientConfig(config: DatabaseConnection, credentials: DatabaseCredentials): ClientConfig {
  if (!config.endpoint.tls.enabled) {
    throw new Error('PostgreSQL requires verified TLS')
  }
  return {
    host: config.endpoint.server,
    port: config.endpoint.port,
    database: config.endpoint.database,
    user: credentials.username,
    password: credentials.password,
    ssl: {
      rejectUnauthorized: true,
      ca: config.endpoint.tls.caCertificate,
      servername: config.endpoint.tls.serverName
    },
    application_name: 'orca-read-only',
    connectionTimeoutMillis: Math.min(config.limits.timeoutMs, 5000),
    query_timeout: config.limits.timeoutMs,
    options: `-c search_path=pg_catalog -c default_transaction_read_only=on -c statement_timeout=${config.limits.timeoutMs} -c lock_timeout=${config.limits.timeoutMs} -c idle_in_transaction_session_timeout=${config.limits.timeoutMs}`
  }
}

export async function withPostgresSession<T>(
  config: DatabaseConnection,
  credentials: DatabaseCredentials,
  signal: AbortSignal,
  operation: (client: Client) => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  const options = clientConfig(config, credentials)
  const client = new Client(options)
  client.on('error', () => {})
  let cancellation: Promise<void> | undefined
  let pid: number | undefined
  const abort = () => {
    cancellation ??= (async () => {
      if (pid) {
        const control = new Client({
          ...options,
          connectionTimeoutMillis: 1000,
          query_timeout: 1000
        })
        control.on('error', () => {})
        try {
          await control.connect()
          await control.query('SELECT pg_catalog.pg_cancel_backend($1)', [pid])
        } catch {
          /* The uncertain session is always destroyed below. */
        } finally {
          await control.end().catch(() => {})
        }
      }
      await client.end().catch(() => {})
    })()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    await client.connect()
    signal.throwIfAborted()
    pid = (await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid')).rows[0]
      .pid
    await client.query('BEGIN READ ONLY')
    const value = await operation(client)
    signal.throwIfAborted()
    await client.query('ROLLBACK')
    return value
  } finally {
    signal.removeEventListener('abort', abort)
    await cancellation
    await client.end().catch(() => {})
  }
}

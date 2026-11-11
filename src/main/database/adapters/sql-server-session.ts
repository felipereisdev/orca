import { sqlServerConnectionError } from './sql-server-connection-error'
import sql from 'mssql'
import type {
  DatabaseConnection,
  DatabaseCredentials
} from '../../../shared/database/database-contracts'

export type SqlServerSession = {
  request(): sql.Request
  query<T>(statement: string, bind?: (request: sql.Request) => void): Promise<sql.IResult<T>>
  run(request: sql.Request, statement: string): Promise<void>
}

export async function withSqlServerSession<T>(
  config: DatabaseConnection,
  credentials: DatabaseCredentials,
  signal: AbortSignal,
  operation: (session: SqlServerSession, signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  if (!config.endpoint.tls.enabled) {
    throw new Error('SQL Server requires verified TLS')
  }
  const pool = new sql.ConnectionPool({
    server: config.endpoint.server,
    port: config.endpoint.port,
    database: config.endpoint.database,
    user: credentials.username,
    password: credentials.password,
    connectionTimeout: Math.min(config.limits.timeoutMs, 5000),
    requestTimeout: config.limits.timeoutMs,
    pool: { min: 0, max: 1 },
    options: {
      encrypt: true,
      trustServerCertificate: config.endpoint.tls.trustServerCertificate === true,
      serverName: config.endpoint.tls.serverName,
      cryptoCredentialsDetails: { ca: config.endpoint.tls.caCertificate },
      appName: 'orca-read-only',
      readOnlyIntent: true,
      cancelTimeout: 1000
    }
  })
  pool.on('error', () => {})
  const transaction = new sql.Transaction(pool)
  let active: sql.Request | undefined
  let begun = false
  const abort = () => active?.cancel()
  signal.addEventListener('abort', abort)
  const execute = async <Row>(
    request: sql.Request,
    statement: string
  ): Promise<sql.IResult<Row> | undefined> => {
    signal.throwIfAborted()
    active = request
    try {
      let result: sql.IResult<Row> | undefined
      if (request.stream) {
        await new Promise<void>((resolve, reject) => {
          let failure: Error | undefined
          request.on('error', (error: Error) => {
            failure ??= error
          })
          request.once('done', () => (failure ? reject(failure) : resolve()))
          request.query(statement)
        })
      } else {
        result = await request.query<Row>(statement)
      }
      signal.throwIfAborted()
      return result
    } finally {
      active = undefined
    }
  }

  try {
    await pool.connect().catch((error: unknown) => {
      throw sqlServerConnectionError(error)
    })
    signal.throwIfAborted()
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
    begun = true
    const session: SqlServerSession = {
      request: () => new sql.Request(transaction),
      run: async (request, statement) => {
        await execute(request, statement)
      },
      query: async <Row>(statement: string, bind?: (request: sql.Request) => void) => {
        const request = new sql.Request(transaction)
        bind?.(request)
        const result = await execute<Row>(request, statement)
        if (!result) {
          throw new Error('Expected SQL Server metadata result')
        }
        return result
      }
    }
    await session.query(
      `SET NOCOUNT ON; SET XACT_ABORT ON; SET DEADLOCK_PRIORITY LOW; SET LOCK_TIMEOUT ${config.limits.timeoutMs}`
    )
    const value = await operation(session, signal)
    signal.throwIfAborted()
    return value
  } finally {
    signal.removeEventListener('abort', abort)
    if (begun) {
      await transaction.rollback().catch(() => {})
    }
    await pool.close().catch(() => {})
  }
}

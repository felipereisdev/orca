import oracledb from 'oracledb'
import type {
  DatabaseConnection,
  DatabaseCredentials
} from '../../../shared/database/database-contracts'

export async function withOracleSession<T>(
  config: DatabaseConnection,
  credentials: DatabaseCredentials,
  signal: AbortSignal,
  operation: (connection: oracledb.Connection, signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  if (
    !oracledb.thin ||
    !config.endpoint.tls.enabled ||
    !/^[a-zA-Z0-9_.:-]+$/.test(config.endpoint.server) ||
    !/^[a-zA-Z0-9_.$#-]+$/.test(config.endpoint.database)
  ) {
    throw new Error('Oracle requires Thin mode, verified TLS and an explicit service name')
  }
  const connection = await oracledb.getConnection({
    user: credentials.username,
    password: credentials.password,
    connectString: `(DESCRIPTION=(CONNECT_TIMEOUT=${Math.max(1, Math.ceil(Math.min(config.limits.timeoutMs, 5000) / 1000))})(TRANSPORT_CONNECT_TIMEOUT=2)(RETRY_COUNT=0)(ADDRESS=(PROTOCOL=TCPS)(HOST=${config.endpoint.server})(PORT=${config.endpoint.port}))(CONNECT_DATA=(SERVICE_NAME=${config.endpoint.database})))`,
    walletContent: config.endpoint.tls.caCertificate,
    sslServerDNMatch: true,
    sslAllowWeakDNMatch: false,
    sslServerCertDN: config.endpoint.tls.serverName,
    stmtCacheSize: 0
  })
  connection.callTimeout = config.limits.timeoutMs
  connection.module = config.accessMode === 'read-write' ? 'orca-read-write' : 'orca-read-only'
  let cancellation: Promise<void> | undefined
  const abort = () => {
    cancellation ??= connection.break().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    await connection.execute(
      `ALTER SESSION SET NLS_NUMERIC_CHARACTERS='.,' NLS_DATE_FORMAT='YYYY-MM-DD"T"HH24:MI:SS' NLS_TIMESTAMP_FORMAT='YYYY-MM-DD"T"HH24:MI:SS.FF9' NLS_TIMESTAMP_TZ_FORMAT='YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM'`
    )
    if (config.accessMode !== 'read-write') {
      await connection.execute('SET TRANSACTION READ ONLY')
    }
    const value = await operation(connection, signal)
    signal.throwIfAborted()
    return value
  } finally {
    signal.removeEventListener('abort', abort)
    await cancellation
    await connection.rollback().catch(() => {})
    await connection.close({ drop: true }).catch(() => {})
  }
}

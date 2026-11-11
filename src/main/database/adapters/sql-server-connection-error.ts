import { DatabaseOperationError } from '../../../shared/database/database-operation-error'

const certificateCodes = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])

export function sqlServerConnectionError(error: unknown): DatabaseOperationError {
  const original = error instanceof Error && 'originalError' in error ? error.originalError : error
  const cause = original instanceof Error ? original.cause : undefined
  const failures = [
    error,
    original,
    cause,
    ...(cause instanceof AggregateError ? cause.errors.slice(0, 8) : [])
  ]
  const codes = failures.flatMap((failure) =>
    failure instanceof Error && 'code' in failure && typeof failure.code === 'string'
      ? [failure.code]
      : []
  )
  if (codes.some((code) => certificateCodes.has(code))) {
    return new DatabaseOperationError('database_tls_verification_failed')
  }
  if (codes.includes('ELOGIN')) {
    return new DatabaseOperationError('database_authentication_failed')
  }
  if (codes.some((code) => code === 'ETIMEOUT' || code === 'ETIMEDOUT')) {
    return new DatabaseOperationError('database_connection_timeout')
  }
  return new DatabaseOperationError('database_connection_failed')
}

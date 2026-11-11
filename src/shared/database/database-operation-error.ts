const messages = {
  database_host_unavailable: 'The configured database execution host is unavailable',
  database_capability_missing:
    'This execution host does not support read-only database connections',
  database_credential_storage_unavailable:
    'Protected credential storage is unavailable on the database execution host',
  database_binding_forbidden:
    'This database execution binding is unavailable to the authenticated controller'
} as const

export type DatabaseOperationErrorCode = keyof typeof messages
export class DatabaseOperationError extends Error {
  constructor(readonly code: DatabaseOperationErrorCode) {
    super(messages[code])
  }
}
export function isDatabaseOperationErrorCode(code: unknown): code is DatabaseOperationErrorCode {
  return typeof code === 'string' && Object.hasOwn(messages, code)
}

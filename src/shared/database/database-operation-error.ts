const messages = {
  database_tls_verification_failed:
    'The database TLS certificate could not be verified. Configure the issuing CA certificate and a server name matching the certificate.',
  database_authentication_failed:
    'The database rejected the login. Check the username, password and access to the selected database.',
  database_connection_timeout:
    'The database connection timed out. Check the server, port and network access.',
  database_connection_failed:
    'Could not establish the database connection. Check the server, port and TLS configuration.',
  database_read_only_profile_refused:
    'Connected to SQL Server, but the account or accessible objects are outside the supported read-only profile. Use a dedicated reader with VIEW DEFINITION and SELECT on approved ordinary tables, without write or administrative permissions.',
  database_read_only_verification_failed:
    'Connected to SQL Server, but its read-only permissions could not be verified. Check metadata access and the supported reader provisioning profile.',

  database_host_unavailable: 'The configured database execution host is unavailable',
  database_capability_missing:
    'This execution host does not support the configured database access mode',
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

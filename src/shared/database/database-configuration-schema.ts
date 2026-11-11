import { z } from 'zod'
import { parseExecutionHostId } from '../execution-host'
import type { DatabaseCatalogState, DatabaseConnection } from './database-contracts'

const host = z.string().transform((value) => {
  const parsed = parseExecutionHostId(value)
  if (!parsed) {
    throw new Error('Invalid database execution host')
  }
  return parsed.id
})
export const databaseConnectionId = z.string().uuid()
export const databaseCredentialRef = z.string().refine((value) => {
  const parts = value.split(':')
  return parts.length === 2 && parts.every((part) => databaseConnectionId.safeParse(part).success)
})
export const databaseProjectSchema = z.object({
  kind: z.enum(['repository', 'folder']),
  projectId: z.string().min(1).max(1024),
  executionHostId: host
})
export const databaseLimitsSchema = z.object({
  timeoutMs: z.number().int().min(1).max(30_000),
  maxRows: z.number().int().min(1).max(1000),
  maxOutputBytes: z
    .number()
    .int()
    .min(1024)
    .max(5 * 1024 * 1024)
})
export const databaseConnectionSchema = z.object({
  id: databaseConnectionId,
  revision: z.number().int().positive(),
  alias: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/),
  displayName: z.string().trim().min(1).max(160),
  engine: z.enum(['postgres', 'sql-server', 'oracle']),
  environment: z.string().trim().min(1).max(80),
  executionHostId: host,
  projects: z.array(databaseProjectSchema).max(1000),
  credentialRef: databaseCredentialRef,
  endpoint: z.object({
    server: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9_.:[\]-]+$/i),
    port: z.number().int().min(1).max(65535),
    database: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^\0\r\n;()\\/]+$/),
    tls: z.object({
      enabled: z.literal(true),
      caCertificate: z
        .string()
        .max(65_536)
        .refine(
          (value) =>
            /^(?:-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*)+$/.test(
              value.trim()
            ),
          'Provide public PEM certificates only'
        )
        .optional(),
      serverName: z.string().min(1).max(253).optional()
    })
  }),
  limits: databaseLimitsSchema
})
const state = z.object({
  controllerId: z.uuid().optional(),
  version: z.literal(1),
  connections: z.array(databaseConnectionSchema).max(1000),
  retiredAliases: z.array(z.string()).max(10_000)
})

export function parseDatabaseConnection(value: unknown): DatabaseConnection {
  const parsed = databaseConnectionSchema.parse(value)
  if (!parsed.credentialRef.startsWith(`${parsed.id}:`)) {
    throw new Error('Credential does not belong to this connection')
  }
  return parsed
}

export function parseDatabaseCatalog(value: unknown): DatabaseCatalogState {
  if (value === undefined) {
    return { version: 1, connections: [], retiredAliases: [] }
  }
  const parsed = state.parse(value)
  const ids = new Set<string>()
  const aliases = new Set<string>()
  for (const item of parsed.connections) {
    if (
      ids.has(item.id) ||
      aliases.has(item.alias) ||
      !item.credentialRef.startsWith(`${item.id}:`)
    ) {
      throw new Error('Saved database catalog contains conflicting identities')
    }
    ids.add(item.id)
    aliases.add(item.alias)
  }
  return parsed
}

export const databaseConnectionInputSchema = databaseConnectionSchema
  .omit({
    revision: true,
    credentialRef: true,
    limits: true
  })
  .extend({
    id: databaseConnectionId.optional(),
    limits: databaseLimitsSchema.partial().optional()
  })

import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
export const databaseQueryPolicyWorkerPath: string = join(
  dirname(createRequire(__filename).resolve('@orca/sql-read-query-parser')),
  'database-query-policy-worker-entry.js'
)

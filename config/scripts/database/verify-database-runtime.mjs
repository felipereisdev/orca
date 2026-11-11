import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { databaseQueryPolicyWorkerPath } from '@orca/sql-read-query-parser/worker-path'

const require = createRequire(import.meta.url)
for (const name of ['pg', 'pg-cursor', 'mssql', 'oracledb']) {
  await import(name)
  console.log(`Loaded ${name}`)
}
assert.equal(require('oracledb').thin, true, 'Oracle must load without a vendor client')
const worker = new Worker(databaseQueryPolicyWorkerPath, { execArgv: [] })
const timer = setTimeout(() => {
  void worker.terminate()
}, 10000)
try {
  const reply = await new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', () => reject(new Error('Database policy worker exited before replying')))
    worker.postMessage({ id: 1, engine: 'postgres', sql: 'SELECT 1' })
  })
  assert.equal(reply.ok, true)
  assert.equal(reply.query.statementSql, 'SELECT 1')
  console.log('Loaded database policy worker')
} finally {
  clearTimeout(timer)
  await worker.terminate()
}

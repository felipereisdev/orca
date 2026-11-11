import { waitForPromiseWithSignal } from '../../../shared/abort-signal-reason'
import type { Worker } from 'node:worker_threads'
import { databaseQueryPolicyWorkerPath } from '@orca/sql-read-query-parser/worker-path'
import type { ValidatedDatabaseReadQuery } from './database-query-policy'
import type { DatabaseEngine } from '../../../shared/database/database-contracts'
import { spawnWorkerThread } from '../../worker-threads/worker-thread-spawn'

let worker: Worker | undefined
let tail: Promise<unknown> = Promise.resolve()
let pending = 0
let sequence = 0
let idle: ReturnType<typeof setTimeout> | undefined

function validateOne(
  engine: DatabaseEngine,
  sql: string,
  signal: AbortSignal
): Promise<ValidatedDatabaseReadQuery> {
  signal.throwIfAborted()
  clearTimeout(idle)
  if (!worker) {
    const created = spawnWorkerThread(databaseQueryPolicyWorkerPath, {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 384 }
    })
    created.on('error', () => {})
    created.once('exit', () => {
      if (worker === created) {
        worker = undefined
      }
    })
    worker = created
  }
  const active = worker
  const id = ++sequence
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (query?: ValidatedDatabaseReadQuery, discard = false) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      active.off('message', message)
      active.off('error', failure)
      active.off('exit', failure)
      const complete = () =>
        query
          ? resolve(Object.freeze(query))
          : reject(new Error('SQL is unsupported, invalid or exceeded its parsing budget'))
      if (discard) {
        if (worker === active) {
          worker = undefined
        }
        void active.terminate().then(complete, complete)
      } else {
        active.unref()
        idle = setTimeout(() => {
          if (worker === active) {
            worker = undefined
            void active.terminate()
          }
        }, 15000)
        idle.unref()
        complete()
      }
    }
    const abort = () => finish(undefined, true)
    const failure = () => finish(undefined, true)
    const message = (reply: { id: number; ok: boolean; query?: ValidatedDatabaseReadQuery }) => {
      if (reply.id === id) {
        finish(
          reply.ok && reply.query?.sql === sql && reply.query.engine === engine
            ? reply.query
            : undefined
        )
      }
    }
    const timer = setTimeout(abort, 2000)
    signal.addEventListener('abort', abort, { once: true })
    active.on('message', message)
    active.on('error', failure)
    active.on('exit', failure)
    active.ref()
    active.postMessage({ id, engine, sql })
  })
}

export async function validateDatabaseReadQueryInWorker(
  engine: DatabaseEngine,
  sql: string,
  signal: AbortSignal = AbortSignal.timeout(5000)
): Promise<ValidatedDatabaseReadQuery> {
  signal.throwIfAborted()
  if (!sql.trim() || Buffer.byteLength(sql) > 65536 || pending >= 20) {
    throw new Error('SQL input or parsing queue exceeds its supported limit')
  }
  pending++
  const previous = tail
  const result = waitForPromiseWithSignal(previous, signal).then(() =>
    validateOne(engine, sql, signal)
  )
  tail = Promise.allSettled([previous, result]).then(() => {
    pending--
  })
  return result
}

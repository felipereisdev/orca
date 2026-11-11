import { databaseQueryFailure } from './database-query-failure'
import { randomUUID } from 'node:crypto'
import type {
  DatabaseQueryHandle,
  DatabaseQueryInput,
  DatabaseQueryRecord,
  DatabaseQuerySnapshot,
  ExpiredDatabaseResult
} from '../../../shared/database/database-query-contracts'
import { sameDatabaseProject } from '../catalog/database-project-scope'
import { DatabaseQueryAdmission, type DatabaseQueryJob } from './database-query-admission'
import { DatabaseQueryOutput } from './database-query-output'
import { DatabaseQueryRecords } from './database-query-records'
import { readAuthorizedDatabaseQueryRecord, type DatabaseActor } from './database-query-actor'
import { executeDatabaseQueryOnHost } from './database-query-executor'
export type { DatabaseActor } from './database-query-actor'

import type { DatabaseQueryServiceOptions } from './database-query-service-options'

export class DatabaseQueryService {
  private readonly admission: DatabaseQueryAdmission
  private readonly records: DatabaseQueryRecords
  private readonly jobs = new Map<string, DatabaseQueryJob>()
  private readonly listeners = new Set<(record: DatabaseQueryRecord) => void>()
  private readonly waiters = new Map<string, Set<() => void>>()
  private disposed = false

  constructor(private readonly options: DatabaseQueryServiceOptions) {
    this.records = options.records ?? new DatabaseQueryRecords(options.store)
    this.admission = options.admission ?? new DatabaseQueryAdmission()
  }

  async start(
    input: DatabaseQueryInput,
    actor: DatabaseActor,
    queryId: string = randomUUID()
  ): Promise<DatabaseQueryHandle> {
    if (
      this.disposed ||
      actor.controllerRuntimeId !== this.options.controllerRuntimeId ||
      !sameDatabaseProject(input.project, actor.project)
    ) {
      throw new Error('Database query is unavailable in this runtime context')
    }
    if (!input.connection || input.sql.length > 65_536 || input.parameters.length > 256) {
      throw new Error('Database query input is invalid')
    }
    const captured = this.options.catalog.resolve(input.connection, actor.project)
    if (
      captured.executionHostId !== this.options.executionHostId &&
      !this.options.remoteExecution
    ) {
      throw new Error('Database connection requires its configured execution host')
    }
    if (
      captured.executionHostId === this.options.executionHostId &&
      !this.options.adapter(captured.engine)
    ) {
      throw new Error('Database engine is unavailable on this execution host')
    }
    const connection = structuredClone(captured)
    if (this.jobs.has(queryId) || this.records.find(queryId)) {
      throw new Error('Database execution ID has already been used; start a new query explicitly')
    }
    const record: DatabaseQueryRecord = {
      queryId,
      source: {
        connectionId: connection.id,
        connectionRevision: connection.revision,
        alias: connection.alias,
        engine: connection.engine,
        environment: connection.environment,
        executionHostId: connection.executionHostId,
        controllerRuntimeId: this.options.controllerRuntimeId
      },
      project: structuredClone(actor.project),
      sessionId: actor.sessionId,
      sql: input.sql,
      parameterNames: input.parameters.map((parameter) => parameter.name),
      createdAt: Date.now(),
      finishedAt: null,
      status: 'queued',
      rowCount: 0,
      truncated: false
    }
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error('Database query deadline exceeded')),
      connection.limits.timeoutMs
    )
    timer.unref?.()
    const job: DatabaseQueryJob = {
      record,
      connection,
      controller,
      timer,
      settled: Promise.resolve()
    }
    this.jobs.set(record.queryId, job)
    try {
      await this.records.save(record)
    } catch (error) {
      clearTimeout(timer)
      this.jobs.delete(record.queryId)
      throw error
    }
    const parameters = structuredClone(input.parameters)
    job.settled = this.admission
      .run(connection.id, () => this.execute(job, parameters), controller.signal)
      .catch(async () => {
        record.status = controller.signal.aborted ? 'cancelled' : 'failed'
        record.finishedAt = Date.now()
        record.error = {
          code: 'database_admission_failed',
          message: 'Database query was cancelled or could not be admitted'
        }
        try {
          await this.records.save(record)
        } catch {
          record.error = {
            code: 'database_history_unavailable',
            message: 'Database query history could not be saved'
          }
        }
      })
      .finally(() => {
        clearTimeout(timer)
        this.jobs.delete(record.queryId)
        this.publish(record)
      })
    this.publish(record)
    return { queryId: record.queryId, source: structuredClone(record.source) }
  }

  queryRecord(queryId: string, actor: DatabaseActor): DatabaseQueryRecord {
    return readAuthorizedDatabaseQueryRecord(
      this.jobs.get(queryId)?.record ?? this.records.find(queryId),
      actor,
      this.options.controllerRuntimeId
    )
  }

  result(queryId: string, actor: DatabaseActor): DatabaseQuerySnapshot | ExpiredDatabaseResult {
    const job = this.jobs.get(queryId)
    const record = this.queryRecord(queryId, actor)
    if (record.status === 'completed') {
      const cached = this.records.get(queryId)
      if (cached) {
        return structuredClone(cached)
      }
      return { status: 'expired', record: structuredClone(record) }
    }
    if (record.status === 'queued' || record.status === 'running') {
      if (!job) {
        return {
          status: 'failed',
          record: {
            ...structuredClone(record),
            status: 'failed',
            error: {
              code: 'database_query_interrupted',
              message: 'This database execution was interrupted; rerun it explicitly'
            }
          }
        }
      }
      return { status: record.status, record: structuredClone(record) }
    }
    return { status: record.status, record: structuredClone(record) }
  }

  async wait(
    queryId: string,
    actor: DatabaseActor,
    signal: AbortSignal
  ): Promise<DatabaseQuerySnapshot> {
    const current = this.result(queryId, actor)
    if (current.status === 'expired') {
      throw new Error('Database query result has expired; rerun explicitly')
    }
    if (current.status !== 'queued' && current.status !== 'running') {
      return current
    }
    if (signal.aborted) {
      throw signal.reason
    }
    await new Promise<void>((resolve, reject) => {
      const listeners = this.waiters.get(queryId) ?? new Set<() => void>()
      const cleanup = () => {
        listeners.delete(done)
        signal.removeEventListener('abort', abort)
      }
      const done = () => {
        cleanup()
        resolve()
      }
      const abort = () => {
        cleanup()
        reject(signal.reason)
      }
      listeners.add(done)
      this.waiters.set(queryId, listeners)
      signal.addEventListener('abort', abort, { once: true })
      if (!this.jobs.has(queryId)) {
        done()
      }
    })
    return this.wait(queryId, actor, signal)
  }

  async cancel(queryId: string, actor: DatabaseActor): Promise<void> {
    this.queryRecord(queryId, actor)
    const job = this.jobs.get(queryId)
    if (!job) {
      return
    }
    job.controller.abort(new Error('Database query cancelled'))
    await job.settled
  }

  history(actor: DatabaseActor): DatabaseQueryRecord[] {
    return this.records
      .history(actor.project)
      .filter((record) => actor.owner || record.sessionId === actor.sessionId)
  }

  onChanged(listener: (record: DatabaseQueryRecord) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  closeSession(sessionId: string): void {
    for (const job of this.jobs.values()) {
      if (job.record.sessionId === sessionId) {
        job.controller.abort()
      }
    }
    this.records.closeSession(sessionId)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const job of this.jobs.values()) {
      job.controller.abort()
    }
    await Promise.allSettled([...this.jobs.values()].map((job) => job.settled))
    this.records.clear()
    this.listeners.clear()
  }

  private publish(record: DatabaseQueryRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(record))
      } catch {
        this.listeners.delete(listener)
      }
    }
    const waiters = this.waiters.get(record.queryId)
    this.waiters.delete(record.queryId)
    for (const waiter of waiters ?? []) {
      waiter()
    }
  }

  private async execute(
    job: DatabaseQueryJob,
    parameters: DatabaseQueryInput['parameters']
  ): Promise<void> {
    const { record, controller, connection } = job
    let phase = 'admission'
    try {
      controller.signal.throwIfAborted()
      const current = this.options.catalog.resolve(connection.id, record.project)
      if (current.revision !== connection.revision) {
        throw new Error('Database connection changed while queued')
      }
      phase = 'policy'
      const { validateDatabaseReadQuery } = await import('../query-policy/database-query-policy')
      const query = validateDatabaseReadQuery(connection.engine, record.sql)
      if (
        query.parameterNames.some(
          (name) => !parameters.some((parameter) => parameter.name === name)
        )
      ) {
        throw new Error('Database query parameters are missing')
      }
      controller.signal.throwIfAborted()
      record.status = 'running'
      this.publish(record)
      phase = 'execution'
      const output = new DatabaseQueryOutput(record, connection.limits)
      await executeDatabaseQueryOnHost(
        this.options,
        record,
        connection,
        query,
        parameters,
        output,
        controller.signal
      )
      controller.signal.throwIfAborted()
      record.status = 'completed'
      record.finishedAt = Date.now()
      this.records.cache(output.finish())
    } catch (error) {
      record.status = controller.signal.aborted ? 'cancelled' : 'failed'
      record.finishedAt = Date.now()
      record.error = databaseQueryFailure(error, phase)
    }
    await this.records.save(record)
  }
}

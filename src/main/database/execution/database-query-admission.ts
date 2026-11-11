import type { DatabaseConnection } from '../../../shared/database/database-contracts'
import type { DatabaseQueryRecord } from '../../../shared/database/database-query-contracts'

export type DatabaseQueryJob = {
  record: DatabaseQueryRecord
  connection: DatabaseConnection
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  settled: Promise<void>
}

type PendingQuery = {
  connectionId: string
  operation: () => Promise<void>
  signal: AbortSignal
  resolve(): void
  reject(error: unknown): void
  abort(): void
}

export class DatabaseQueryAdmission {
  private readonly pending: PendingQuery[] = []
  private readonly connections = new Map<string, number>()
  private active = 0

  run(connectionId: string, operation: () => Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(signal.reason)
    }
    if (this.pending.length >= 20) {
      return Promise.reject(new Error('Database query queue is full'))
    }
    return new Promise((resolve, reject) => {
      const query: PendingQuery = {
        connectionId,
        operation,
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.pending.indexOf(query)
          if (index !== -1) {
            this.pending.splice(index, 1)
          }
          reject(signal.reason)
          this.pump()
        }
      }
      signal.addEventListener('abort', query.abort, { once: true })
      this.pending.push(query)
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < 10) {
      const index = this.pending.findIndex(
        (query) => (this.connections.get(query.connectionId) ?? 0) < 2
      )
      if (index === -1) {
        return
      }
      const query = this.pending.splice(index, 1)[0]
      query.signal.removeEventListener('abort', query.abort)
      this.active++
      this.connections.set(query.connectionId, (this.connections.get(query.connectionId) ?? 0) + 1)
      void Promise.resolve()
        .then(query.operation)
        .then(query.resolve, query.reject)
        .finally(() => {
          this.active--
          const remaining = (this.connections.get(query.connectionId) ?? 1) - 1
          if (remaining) {
            this.connections.set(query.connectionId, remaining)
          } else {
            this.connections.delete(query.connectionId)
          }
          this.pump()
        })
    }
  }
}

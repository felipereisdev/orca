import type { DatabaseProjectKey } from '../../../shared/database/database-contracts'
import type {
  DatabaseQueryRecord,
  DatabaseQuerySnapshot
} from '../../../shared/database/database-query-contracts'
import type { DatabasePersistence } from '../../persistence/loading-store/database-persistence'
import { sameDatabaseProject } from '../catalog/database-project-scope'

type CompletedResult = Extract<DatabaseQuerySnapshot, { status: 'completed' }>

export class DatabaseQueryRecords {
  private readonly results = new Map<
    string,
    { result: CompletedResult; bytes: number; expiresAt: number }
  >()
  private cacheBytes = 0

  constructor(
    private readonly persistence: Pick<
      DatabasePersistence,
      'getDatabaseQueryHistory' | 'saveDatabaseQueryRecord'
    >
  ) {}

  save(record: DatabaseQueryRecord): Promise<void> {
    return this.persistence.saveDatabaseQueryRecord(structuredClone(record))
  }

  history(project: DatabaseProjectKey): DatabaseQueryRecord[] {
    return this.persistence
      .getDatabaseQueryHistory()
      .filter((record) => sameDatabaseProject(record.project, project))
  }

  find(queryId: string): DatabaseQueryRecord | undefined {
    return this.persistence.getDatabaseQueryHistory().find((record) => record.queryId === queryId)
  }

  cache(result: CompletedResult): void {
    this.sweep()
    const bytes = Buffer.byteLength(JSON.stringify(result))
    while (this.cacheBytes + bytes > 25 * 1024 * 1024 && this.results.size) {
      const oldest = this.results.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.remove(oldest)
    }
    this.results.set(result.record.queryId, { result, bytes, expiresAt: Date.now() + 15 * 60_000 })
    this.cacheBytes += bytes
  }

  get(queryId: string): CompletedResult | undefined {
    this.sweep()
    return this.results.get(queryId)?.result
  }

  closeSession(sessionId: string): void {
    for (const [id, entry] of this.results) {
      if (entry.result.record.sessionId === sessionId) {
        this.remove(id)
      }
    }
  }

  clear(): void {
    this.results.clear()
    this.cacheBytes = 0
  }

  private sweep(): void {
    const now = Date.now()
    for (const [id, entry] of this.results) {
      if (entry.expiresAt <= now) {
        this.remove(id)
      }
    }
  }

  private remove(id: string): void {
    const entry = this.results.get(id)
    if (!entry) {
      return
    }
    this.cacheBytes -= entry.bytes
    this.results.delete(id)
  }
}

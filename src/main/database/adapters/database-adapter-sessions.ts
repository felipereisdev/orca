import type {
  DatabaseConnection,
  DatabaseCredentials
} from '../../../shared/database/database-contracts'
export type DatabaseSessionOperation<Client> = <T>(
  configuration: DatabaseConnection,
  credentials: DatabaseCredentials,
  signal: AbortSignal,
  operation: (client: Client) => Promise<T>
) => Promise<T>
export function createDatabaseAdapterSessions<Client>(connect: DatabaseSessionOperation<Client>) {
  const active = new Map<AbortController, Promise<void>>()
  let disposed = false
  const run: DatabaseSessionOperation<Client> = async (
    configuration,
    credentials,
    signal,
    operation
  ) => {
    if (disposed) {
      throw new Error('Database adapter is closed')
    }
    const controller = new AbortController()
    let settled!: () => void
    active.set(
      controller,
      new Promise<void>((resolve) => {
        settled = resolve
      })
    )
    try {
      return await connect(
        configuration,
        credentials,
        AbortSignal.any([
          signal,
          controller.signal,
          AbortSignal.timeout(configuration.limits.timeoutMs)
        ]),
        operation
      )
    } finally {
      active.delete(controller)
      settled()
    }
  }
  return {
    run,
    dispose: async () => {
      disposed = true
      for (const controller of active.keys()) {
        controller.abort(new Error('Database adapter disposed'))
      }
      await Promise.all(active.values())
    }
  }
}

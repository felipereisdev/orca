import type { OrcaRuntimeService } from '../orca-runtime'
import type { OrcaRuntimeWithRuntimeId } from '../construction/runtime-identity-state'
import type { RuntimeDatabaseCommands } from './runtime-database-commands'

const controllers = new WeakMap<OrcaRuntimeWithRuntimeId, Promise<RuntimeDatabaseCommands>>()
const closed = new WeakSet<OrcaRuntimeWithRuntimeId>()

export function runtimeDatabaseCommands(
  runtime: OrcaRuntimeService
): Promise<RuntimeDatabaseCommands> {
  if (closed.has(runtime)) {
    return Promise.reject(new Error('Database runtime is closed'))
  }
  let commands = controllers.get(runtime)
  if (!commands) {
    commands = import('./runtime-database-commands').then(
      ({ RuntimeDatabaseCommands }) => new RuntimeDatabaseCommands(runtime)
    )
    controllers.set(runtime, commands)
    void commands.catch(() => {
      controllers.delete(runtime)
    })
  }
  return commands
}

export async function disposeRuntimeDatabase(runtime: OrcaRuntimeService): Promise<void> {
  closed.add(runtime)
  await (await controllers.get(runtime))?.dispose()
}

export function closeRuntimeDatabaseSession(
  runtime: OrcaRuntimeWithRuntimeId,
  sessionId: string
): void {
  void controllers.get(runtime)?.then(
    (commands) => commands.queries.closeSession(sessionId),
    () => {}
  )
}

export function closeRuntimeDatabaseTerminals(
  runtime: OrcaRuntimeWithRuntimeId,
  handles: readonly string[]
): void {
  void controllers.get(runtime)?.then(
    (commands) => {
      for (const handle of handles) {
        commands.queries.closeTerminal(handle)
      }
    },
    () => {}
  )
}

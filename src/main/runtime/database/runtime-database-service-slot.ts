import type { OrcaRuntimeService } from '../orca-runtime'
import type { RuntimeDatabaseCommands } from './runtime-database-commands'

const controllers = new WeakMap<OrcaRuntimeService, Promise<RuntimeDatabaseCommands>>()
const closed = new WeakSet<OrcaRuntimeService>()

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

import { databaseActor } from '../../../database/database-project-context'
import { runtimeDatabaseCommands } from '../../../database/runtime-database-service-slot'
import { defineMethod } from '../../core'
import { OpenDatabaseTab } from '../../../../../shared/rpc-contract/session-tabs-schemas-params'

export const SESSION_TAB_DATABASE_OPEN_METHOD = defineMethod({
  name: 'session.tabs.openDatabase',
  permission: 'workspace',
  params: OpenDatabaseTab,
  handler: async (params, context) => {
    const actor = await databaseActor(context, { worktree: params.worktree })
    if (actor.controllerRuntimeId !== params.connection.controllerRuntimeId) {
      throw new Error('Database controller does not match this host')
    }
    const connection = (await runtimeDatabaseCommands(context.runtime)).catalog
      .list(actor.project)
      .find((entry) => entry.id === params.connection.connectionId)
    if (!connection) {
      throw new Error('Database connection is not available in this project')
    }
    const worktree = await context.runtime.showManagedWorktree(params.worktree, undefined, {
      matchFolders: true
    })
    return context.runtime.openMobileSessionDatabaseTab(
      worktree.id,
      JSON.stringify(params.connection),
      connection.displayName || connection.alias
    )
  }
})

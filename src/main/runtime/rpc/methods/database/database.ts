import { defineMethod, type RpcContext } from '../../core'
import {
  DatabaseScope,
  DatabaseDescribe,
  DatabaseStartQuery,
  DatabaseQueryId,
  DatabaseSave,
  DatabaseConfigurationId,
  DatabaseRemove
} from '../../../../../shared/rpc-contract/database-params'
import { runtimeDatabaseCommands } from '../../../database/runtime-database-commands'
import { databaseActor } from '../../../database/database-project-context'

function signal(context: RpcContext): AbortSignal {
  return context.signal ?? AbortSignal.timeout(30_000)
}

export const DATABASE_METHODS = [
  defineMethod({
    name: 'database.list',
    permission: 'workspace',
    params: DatabaseScope,
    handler: async (params, context) => {
      const actor = await databaseActor(context, params)
      return runtimeDatabaseCommands(context.runtime).catalog.list(actor.project)
    }
  }),
  defineMethod({
    name: 'database.describe',
    permission: 'workspace',
    params: DatabaseDescribe,
    handler: async (params, context) => {
      const actor = await databaseActor(context, params)
      return runtimeDatabaseCommands(context.runtime).describe(
        { ...params, project: actor.project },
        signal(context)
      )
    }
  }),
  defineMethod({
    name: 'database.startQuery',
    permission: 'workspace',
    params: DatabaseStartQuery,
    handler: async (params, context) => {
      const actor = await databaseActor(context, params)
      return runtimeDatabaseCommands(context.runtime).queries.start(
        { ...params, project: actor.project },
        actor
      )
    }
  }),
  defineMethod({
    name: 'database.waitQuery',
    permission: 'workspace',
    params: DatabaseQueryId,
    handler: async (params, context) => {
      const actor = await databaseActor(context, params)
      const queries = runtimeDatabaseCommands(context.runtime).queries
      const deadline = AbortSignal.timeout(25_000)
      try {
        return await queries.wait(
          params.queryId,
          actor,
          AbortSignal.any([signal(context), deadline])
        )
      } catch (error) {
        if (deadline.aborted && !context.signal?.aborted) {
          return queries.result(params.queryId, actor)
        }
        throw error
      }
    }
  }),
  defineMethod({
    name: 'database.cancelQuery',
    permission: 'workspace',
    params: DatabaseQueryId,
    handler: async (params, context) =>
      runtimeDatabaseCommands(context.runtime).queries.cancel(
        params.queryId,
        await databaseActor(context, params)
      )
  }),
  defineMethod({
    name: 'database.queryResult',
    permission: 'workspace',
    params: DatabaseQueryId,
    handler: async (params, context) =>
      runtimeDatabaseCommands(context.runtime).queries.result(
        params.queryId,
        await databaseActor(context, params)
      )
  }),
  defineMethod({
    name: 'database.queryHistory',
    permission: 'workspace',
    params: DatabaseScope,
    handler: async (params, context) =>
      runtimeDatabaseCommands(context.runtime).queries.history(await databaseActor(context, params))
  }),
  defineMethod({
    name: 'database.catalog',
    permission: 'settings-write',
    params: null,
    handler: (_params, { runtime }) => runtimeDatabaseCommands(runtime).catalog.list()
  }),
  defineMethod({
    name: 'database.configuration',
    permission: 'settings-write',
    params: DatabaseConfigurationId,
    handler: (params, { runtime }) =>
      runtimeDatabaseCommands(runtime).catalog.getConfiguration(params.connectionId)
  }),
  defineMethod({
    name: 'database.save',
    permission: 'accounts-admin',
    params: DatabaseSave,
    handler: (params, { runtime }) =>
      runtimeDatabaseCommands(runtime).save(
        params.configuration,
        params.credentials,
        params.expectedRevision
      )
  }),
  defineMethod({
    name: 'database.remove',
    permission: 'accounts-admin',
    params: DatabaseRemove,
    handler: (params, { runtime }) =>
      runtimeDatabaseCommands(runtime).remove(params.connectionId, params.expectedRevision)
  }),
  defineMethod({
    name: 'database.testConnection',
    permission: 'accounts-admin',
    params: DatabaseConfigurationId,
    handler: (params, context) =>
      runtimeDatabaseCommands(context.runtime).test(params.connectionId, signal(context))
  })
]

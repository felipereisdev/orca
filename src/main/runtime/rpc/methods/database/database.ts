import {
  databaseSessionQuery,
  databaseSessionQueryRecord
} from '../../../database/database-session-query'
import { resolveRuntimeDatabaseMentions } from '../../../database/database-mention-context'
import { defineMethod, type RpcContext } from '../../core'
import {
  DatabaseExecutionHost,
  DatabaseScope,
  DatabaseMentions,
  DatabaseDescribe,
  DatabaseStartQuery,
  DatabaseQueryId,
  DatabaseSessionQuery,
  DatabaseSave,
  DatabaseConfigurationId,
  DatabaseRemove
} from '../../../../../shared/rpc-contract/database-params'
import { runtimeDatabaseCommands } from '../../../database/runtime-database-service-slot'
import { databaseActor } from '../../../database/database-project-context'

function signal(context: RpcContext): AbortSignal {
  return context.signal ?? AbortSignal.timeout(30_000)
}

export const DATABASE_METHODS = [
  defineMethod({
    name: 'database.settingsOptions',
    permission: 'settings-write',
    params: null,
    handler: async (_params, { runtime }) =>
      (await runtimeDatabaseCommands(runtime)).settingsOptions()
  }),
  defineMethod({
    name: 'database.executionCapabilities',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) =>
      (await runtimeDatabaseCommands(runtime)).executionCapabilities()
  }),
  defineMethod({
    name: 'database.hostCapabilities',
    permission: 'settings-write',
    params: DatabaseExecutionHost,
    handler: async (params, { runtime }) =>
      (await runtimeDatabaseCommands(runtime)).hostCapabilities(params.executionHostId)
  }),
  defineMethod({
    name: 'database.list',
    permission: 'workspace',
    params: DatabaseScope,
    handler: async (params, context) => {
      const actor = await databaseActor(context, params)
      return (await runtimeDatabaseCommands(context.runtime)).catalog.list(actor.project)
    }
  }),
  defineMethod({
    name: 'database.resolveMentions',
    permission: 'workspace',
    params: DatabaseMentions,
    handler: async (params, context) => {
      await databaseActor(context, params)
      return resolveRuntimeDatabaseMentions(context.runtime, params, params.references)
    }
  }),
  defineMethod({
    name: 'database.describe',
    permission: 'workspace',
    params: DatabaseDescribe,
    handler: async (params, context) => {
      const actor = await databaseActor(context, params)
      return (await runtimeDatabaseCommands(context.runtime)).describe(
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
      return (await runtimeDatabaseCommands(context.runtime)).queries.start(
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
      const queries = (await runtimeDatabaseCommands(context.runtime)).queries
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
      (await runtimeDatabaseCommands(context.runtime)).queries.cancel(
        params.queryId,
        await databaseActor(context, params)
      )
  }),
  defineMethod({
    name: 'database.queryResult',
    permission: 'workspace',
    params: DatabaseQueryId,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).queries.result(
        params.queryId,
        await databaseActor(context, params)
      )
  }),
  defineMethod({
    name: 'database.sessionQueryRecord',
    permission: 'workspace',
    params: DatabaseSessionQuery,
    handler: (params, context) => databaseSessionQueryRecord(context, params)
  }),
  defineMethod({
    name: 'database.sessionQuery',
    permission: 'workspace',
    params: DatabaseSessionQuery,
    handler: (params, context) => databaseSessionQuery(context, params)
  }),
  defineMethod({
    name: 'database.queryHistory',
    permission: 'workspace',
    params: DatabaseScope,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).queries.history(
        await databaseActor(context, params)
      )
  }),
  defineMethod({
    name: 'database.catalog',
    permission: 'settings-write',
    params: null,
    handler: async (_params, { runtime }) => (await runtimeDatabaseCommands(runtime)).catalog.list()
  }),
  defineMethod({
    name: 'database.configuration',
    permission: 'settings-write',
    params: DatabaseConfigurationId,
    handler: async (params, { runtime }) =>
      (await runtimeDatabaseCommands(runtime)).catalog.getConfiguration(params.connectionId)
  }),
  defineMethod({
    name: 'database.save',
    permission: 'accounts-admin',
    params: DatabaseSave,
    handler: async (params, { runtime }) =>
      (await runtimeDatabaseCommands(runtime)).save(
        params.configuration,
        params.credentials,
        params.expectedRevision
      )
  }),
  defineMethod({
    name: 'database.remove',
    permission: 'accounts-admin',
    params: DatabaseRemove,
    handler: async (params, { runtime }) =>
      (await runtimeDatabaseCommands(runtime)).remove(params.connectionId, params.expectedRevision)
  }),
  defineMethod({
    name: 'database.testConnection',
    permission: 'accounts-admin',
    params: DatabaseConfigurationId,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).test(params.connectionId, signal(context))
  })
]

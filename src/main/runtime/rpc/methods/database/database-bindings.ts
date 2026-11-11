import { defineMethod, type RpcContext } from '../../core'
import { runtimeDatabaseCommands } from '../../../database/runtime-database-service-slot'
import {
  DatabaseBindingRef,
  DatabaseBindingEnroll,
  DatabaseBindingDescribe,
  DatabaseBindingQuery,
  DatabaseBindingStart
} from '../../../../../shared/rpc-contract/database-params'
import { rpcCallerOperationKey } from '../../rpc-caller-identity'

function principal(context: RpcContext): string {
  if (!context.caller) {
    throw new Error('Database controller identity is unavailable')
  }
  if (context.caller.kind === 'paired-device') {
    if (!context.authenticatedCallerFingerprint) {
      throw new Error('Database controller authentication is unavailable')
    }
    return context.authenticatedCallerFingerprint
  }
  return rpcCallerOperationKey(context.caller)
}
function signal(context: RpcContext) {
  return context.signal ?? AbortSignal.timeout(30000)
}

export const DATABASE_BINDING_METHODS = [
  defineMethod({
    name: 'database.enrollBinding',
    permission: 'accounts-admin',
    params: DatabaseBindingEnroll,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).bindings.enroll(
        principal(context),
        params.controllerRuntimeId,
        params.configuration,
        params.credentials,
        params.previousCredentialRef
      )
  }),
  defineMethod({
    name: 'database.removeBinding',
    permission: 'accounts-admin',
    params: DatabaseBindingRef,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).bindings.remove(
        principal(context),
        params.credentialRef
      )
  }),
  defineMethod({
    name: 'database.testBinding',
    permission: 'workspace',
    params: DatabaseBindingRef,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).boundQueries.test(
        principal(context),
        params.credentialRef,
        signal(context)
      )
  }),
  defineMethod({
    name: 'database.describeBinding',
    permission: 'workspace',
    params: DatabaseBindingDescribe,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).boundQueries.describe(
        principal(context),
        params,
        signal(context)
      )
  }),
  defineMethod({
    name: 'database.startBindingQuery',
    permission: 'workspace',
    params: DatabaseBindingStart,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).boundQueries.start(
        principal(context),
        params
      )
  }),
  defineMethod({
    name: 'database.waitBindingQuery',
    permission: 'workspace',
    params: DatabaseBindingQuery,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).boundQueries.wait(
        principal(context),
        params,
        signal(context)
      )
  }),
  defineMethod({
    name: 'database.cancelBindingQuery',
    permission: 'workspace',
    params: DatabaseBindingQuery,
    handler: async (params, context) =>
      (await runtimeDatabaseCommands(context.runtime)).boundQueries.cancel(
        principal(context),
        params
      )
  })
]

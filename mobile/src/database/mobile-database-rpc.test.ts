import { describe, expect, it } from 'vitest'
import { createFakeRpcClient, rpcSuccess } from '../mobile-web-shell/bridge-host-test-fakes'
import { scopeRpcClientToExecutionHost } from '../worktree/execution-host-scoped-rpc-client'
import { RpcIncompatibleReplyError } from '../transport/rpc/rpc-incompatible-reply-error'
import { createMobileDatabaseClient } from './mobile-database-rpc'

describe('mobile database RPC boundary', () => {
  it('refuses runtime status metadata in place of a persisted database controller identity', async () => {
    const transport = createFakeRpcClient()
    const database = createMobileDatabaseClient(transport, 'workspace-a')
    const identity = database.controllerIdentity()
    transport.requests[0].resolve(rpcSuccess('identity', { runtimeId: 'runtime-a' }))
    await expect(identity).rejects.toBeInstanceOf(RpcIncompatibleReplyError)
  })

  it('keeps query submission on the selected folder host and refuses disconnected replay', async () => {
    const transport = createFakeRpcClient()
    const database = createMobileDatabaseClient(
      scopeRpcClientToExecutionHost(transport, 'runtime:server-a'),
      'folder:workspace-a'
    )
    const submission = database.start('connection-a', 'DELETE FROM obsolete_rows')
    const request = transport.requests[0]
    expect(request.args).toEqual([
      'database.startQuery',
      {
        worktree: 'id:folder:workspace-a',
        connection: 'connection-a',
        sql: 'DELETE FROM obsolete_rows',
        parameters: []
      },
      {
        failWhenDisconnected: true,
        timeoutMs: 30_000,
        envelope: { executionHost: 'runtime:server-a' }
      }
    ])
    const deliveryUnknown = new Error('delivery unknown')
    request.reject(deliveryUnknown)
    await expect(submission).rejects.toBe(deliveryUnknown)
  })

  it('rejects a malformed host schema before the screen can adopt it', async () => {
    const transport = createFakeRpcClient()
    const database = createMobileDatabaseClient(transport, 'workspace-a')
    const inspection = database.describe('connection-a')
    transport.requests[0].resolve(
      rpcSuccess('schema', {
        schemas: ['public'],
        tables: [{ name: 'users' }],
        columns: [],
        truncated: false
      })
    )
    await expect(inspection).rejects.toBeInstanceOf(RpcIncompatibleReplyError)
  })

  it('preserves host refusals instead of treating unavailable history as empty', async () => {
    const transport = createFakeRpcClient()
    const database = createMobileDatabaseClient(transport, 'workspace-a')
    const history = database.history()
    transport.requests[0].resolve({
      id: 'history',
      ok: false,
      error: { code: 'permission_denied', message: 'Database query is unavailable in this session' }
    })
    await expect(history).rejects.toThrow('permission_denied')
  })
})

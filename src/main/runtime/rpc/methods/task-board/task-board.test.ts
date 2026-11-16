import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { setSecretStore } from '../../../../../shared/secure-storage/secret-store'
import { Store } from '../../../../persistence/loading-store/store'
import { createSqliteTestStore } from '../../../../persistence/persistence-test-harness'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { RpcDispatcher } from '../../dispatcher'
import { MOBILE_RPC_METHOD_ROUTES } from '../../server/runtime-rpc-mobile-method-routing'
import { TASK_BOARD_METHODS } from './task-board'

const ref = { provider: 'jira', siteId: 'site-a', key: 'APP-1' }

it('keeps the newest read marker when an older one arrives, across a store reload', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-task-board-'))
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: (value) => value.toString().slice('sealed:'.length),
    describeProtectionGap: () => null
  })
  const dataFile = join(directory, 'state.json')
  let store = createSqliteTestStore(Store, { dataFile })
  const dispatcher = new RpcDispatcher({
    runtime: new OrcaRuntimeService(store),
    methods: TASK_BOARD_METHODS
  })
  const markSeen = (at: string, id: string) =>
    dispatcher.dispatch({
      id: 'mark',
      authToken: 'token',
      method: 'taskBoard.markSeen',
      params: { ref, at, id }
    })
  try {
    // A phone that rendered the newer comment, then a desktop still showing an older one.
    expect(await markSeen('2026-11-14T12:00:00.000Z', 'c-2')).toMatchObject({
      ok: true,
      result: { ok: true }
    })
    expect(await markSeen('2026-11-14T10:00:00.000Z', 'c-1')).toMatchObject({ ok: true })
    store.flush()
    await store.freezeWritesAsync()
    store = createSqliteTestStore(Store, { dataFile })
    expect(store.getUI().taskBoardSeenComments).toEqual({
      'jira:site-a:APP-1': { at: '2026-11-14T12:00:00.000Z', ids: ['c-2'] }
    })
  } finally {
    await store.freezeWritesAsync()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('routes the board to the phone’s execution host without opening Jira writes to phones', () => {
  expect(MOBILE_RPC_METHOD_ROUTES.get('taskBoard.list')).toBe('execution-host')
  expect(MOBILE_RPC_METHOD_ROUTES.get('taskBoard.detail')).toBe('execution-host')
  expect(MOBILE_RPC_METHOD_ROUTES.get('taskBoard.addComment')).toBe('execution-host')
  expect(MOBILE_RPC_METHOD_ROUTES.get('taskBoard.markSeen')).toBe('execution-host')
  expect(MOBILE_RPC_METHOD_ROUTES.get('taskBoard.move')).toBe('execution-host')
  expect(MOBILE_RPC_METHOD_ROUTES.has('jira.updateIssue')).toBe(false)
})

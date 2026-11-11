import { expect, it } from 'vitest'
import { z } from 'zod'
import { createDatabaseTestProfile } from '../../database/catalog/testing/database-profile-fixture'
import { OrcaRuntimeService } from '../orca-runtime'
import { registerBoundPty } from '../orca-runtime-tests/bind-first-pane.test-fixture'
import { RpcDispatcher } from '../rpc/dispatcher'
import { defineMethod } from '../rpc/core'
import { DatabaseScope } from '../../../shared/rpc-contract/database-params'
import { databaseActor } from './database-project-context'
import { OrchestrationRequestEvidence } from '../../../cli/runtime/orchestration-compatibility-envelope'

it('binds attested terminal CLI calls to their live terminal and refuses another workspace or stale evidence', async () => {
  const profile = createDatabaseTestProfile()
  try {
    const group = profile.store.createProjectGroup({ name: 'Notes', createdFrom: 'manual' })
    const folder = profile.store.createFolderWorkspace({
      projectGroupId: group.id,
      folderPath: '/fixture/notes'
    })
    const other = profile.store.createFolderWorkspace({
      projectGroupId: group.id,
      folderPath: '/fixture/other'
    })
    const runtime = new OrcaRuntimeService(profile.store)
    const leafId = '11111111-1111-4111-8111-111111111111'
    registerBoundPty(runtime, 'pty-database', `folder:${folder.id}`, null, {
      tabId: 'db-tab',
      leafId,
      incarnationId: '22222222-2222-4222-8222-222222222222',
      agentLaunchAuthority: { launchToken: 'launch-secret', launchAgent: 'codex' }
    })
    const terminal = (await runtime.listTerminals()).terminals[0]
    if (!terminal) {
      throw new Error('Expected registered terminal')
    }
    const evidence = new OrchestrationRequestEvidence({
      ORCA_TERMINAL_HANDLE: terminal.handle,
      ORCA_PANE_KEY: `db-tab:${leafId}`,
      ORCA_AGENT_LAUNCH_TOKEN: 'launch-secret'
    })
    const envelope = evidence.envelopeFor('database.actorFixture', {
      remote: false,
      mutation: false,
      requestId: undefined
    })
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: [
        defineMethod({
          name: 'database.actorFixture',
          permission: 'workspace',
          params: DatabaseScope,
          handler: (params, context) => databaseActor(context, params)
        })
      ]
    })
    const response = await dispatcher.dispatch({
      id: 'terminal',
      authToken: 'fixture',
      method: 'database.actorFixture',
      params: { project: folder.id },
      ...envelope
    })
    expect(response.ok).toBe(true)
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    expect(
      z
        .object({ owner: z.boolean(), terminalHandle: z.string(), sessionId: z.string() })
        .parse(response.result)
    ).toEqual({
      owner: false,
      terminalHandle: terminal.handle,
      sessionId: `terminal:${terminal.handle}:pty-database:22222222-2222-4222-8222-222222222222`
    })
    expect(
      (
        await dispatcher.dispatch({
          id: 'other',
          authToken: 'fixture',
          method: 'database.actorFixture',
          params: { project: other.id },
          ...envelope
        })
      ).ok
    ).toBe(false)
    runtime.onPtyExit('pty-database', 0, '22222222-2222-4222-8222-222222222222', {
      hostExitConfirmed: true
    })
    expect(
      (
        await dispatcher.dispatch({
          id: 'stale',
          authToken: 'fixture',
          method: 'database.actorFixture',
          params: { project: folder.id },
          ...envelope
        })
      ).ok
    ).toBe(false)
  } finally {
    await profile.close()
  }
})

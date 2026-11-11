import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openTestAgentSessionRecordStore } from './agent-session-record-store-test-harness'
import { closeTestJournalHostDatabases } from '../../../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import type { AgentSessionReserveRequest } from '../ownership/agent-session-reservation-admission'
import { structuredAgentSessionCreateFingerprint } from '../../../../shared/agent-session/lifecycle/structured-agent-session-mutation'

let root: string
afterEach(async () => {
  await closeTestJournalHostDatabases()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

function request(claudeAccountId: string): AgentSessionReserveRequest {
  return {
    sessionId: 'pinned-chat',
    provider: 'claude',
    claudeAccountId,
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/account/work' },
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'folder-1',
      workspaceKind: 'folder'
    },
    expectedFence: null,
    spawnToken: 'spawn-a',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'indeterminate', reason: 'no answer' },
    operation: {
      callerKey: 'client-1',
      operationId: '1800000000000-00000000000000000000000000000001',
      fingerprint: structuredAgentSessionCreateFingerprint({
        agent: 'claude',
        worktree: 'id:folder-1',
        claudeAccountId,
        sessionId: 'pinned-chat'
      })
    },
    now: 1_800_000_000_000
  }
}

it('retains the account through committed record reload and refuses replay with another account', async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-pinned-chat-'))
  const store = await openTestAgentSessionRecordStore(root)
  await store.founding.commit(request('work'))
  const reloaded = await openTestAgentSessionRecordStore(root)
  expect(reloaded.getRecord('pinned-chat')?.claudeAccountId).toBe('work')
  expect(store.founding.prepare(request('work'))).toMatchObject({
    disposition: 'replayed',
    record: { claudeAccountId: 'work' }
  })
  expect(() => store.founding.prepare(request('personal'))).toThrow(
    expect.objectContaining({
      refusal: expect.objectContaining({ code: 'agent_session_operation_conflict' })
    })
  )
})

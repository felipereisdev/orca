import { expect, it } from 'vitest'
import {
  attach,
  CALLER,
  envelope,
  hostTestState
} from './structured-agent-session-host-test-harness'
import { hostTestMessage } from './structured-agent-session-host-test-data'
it('refuses stale selected databases before delivery while replaying an already accepted send', async () => {
  const { host } = hostTestState()
  await attach()
  const body = {
    ...hostTestMessage('Consult @faturacao-hmg'),
    databaseReferences: [
      {
        kind: 'database' as const,
        connectionId: '11111111-1111-4111-8111-111111111111',
        controllerRuntimeId: 'controller',
        aliasAtSelection: 'faturacao-hmg',
        tokenOccurrence: 0
      }
    ]
  }
  host.deps.validateDatabaseMentions = async () => {
    throw new Error('Removed')
  }
  const refused = await host.send(CALLER, {
    envelope: envelope('agentSession.send', { body }),
    body
  })
  expect(refused).toMatchObject({ ok: false, refusal: { code: 'agent_session_operation_invalid' } })
  host.deps.validateDatabaseMentions = async () => {}
  const send = { envelope: envelope('agentSession.send', { body }), body }
  await expect(host.send(CALLER, send)).resolves.toMatchObject({ ok: true })
  host.deps.validateDatabaseMentions = async () => {
    throw new Error('Removed after acceptance')
  }
  await expect(host.send(CALLER, send)).resolves.toMatchObject({ ok: true })
})

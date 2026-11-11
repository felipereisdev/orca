import { describe, expect, it } from 'vitest'
import { OrchestrationRequestEvidence } from './orchestration-compatibility-envelope'

const CHAT = { ORCA_AGENT_SESSION_ID: '11111111-1111-4111-8111-111111111111' }

describe('caller evidence on requests to another server', () => {
  it('binds local database execution to the injected chat session', () => {
    const evidence = new OrchestrationRequestEvidence(CHAT)
    expect(
      evidence.envelopeFor('database.startQuery', {
        remote: false,
        mutation: false,
        requestId: undefined
      }).orchestrationCompatibilityEvidence
    ).toEqual({ agentSessionId: '11111111-1111-4111-8111-111111111111' })
  })
  it('sends a chat read there like a shell, with no session id', () => {
    const evidence = new OrchestrationRequestEvidence(CHAT)
    expect(
      evidence.envelopeFor('orchestration.inbox', {
        remote: true,
        mutation: false,
        requestId: undefined
      }).orchestrationCompatibilityEvidence
    ).toBeUndefined()
  })

  it('keeps the session id on writes there, so that server still refuses them', () => {
    const evidence = new OrchestrationRequestEvidence(CHAT)
    expect(
      evidence.envelopeFor('orchestration.taskCreate', {
        remote: true,
        mutation: true,
        requestId: 'request_1'
      }).orchestrationCompatibilityEvidence
    ).toEqual({ agentSessionId: '11111111-1111-4111-8111-111111111111' })
  })
})

it('retains terminal attestation for local database calls and strips it on another runtime', () => {
  const evidence = new OrchestrationRequestEvidence({
    ORCA_TERMINAL_HANDLE: 'term_a',
    ORCA_PANE_KEY: 'tab_a:leaf_a',
    ORCA_AGENT_LAUNCH_TOKEN: 'launch-a'
  })
  expect(
    evidence.envelopeFor('database.startQuery', {
      remote: false,
      mutation: false,
      requestId: undefined
    })
  ).toEqual({
    orchestrationCompatibilityEvidence: {
      terminalHandle: 'term_a',
      paneKey: 'tab_a:leaf_a',
      launchToken: 'launch-a'
    }
  })
  expect(
    evidence.envelopeFor('database.startQuery', {
      remote: true,
      mutation: false,
      requestId: undefined
    })
  ).toEqual({})
})

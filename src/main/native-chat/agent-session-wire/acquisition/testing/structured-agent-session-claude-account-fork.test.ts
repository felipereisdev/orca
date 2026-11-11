import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  createRestTestRig,
  type RestTestRig
} from '../../host/testing/structured-agent-session-rest-test-rig'
import { forkTestSource } from './structured-agent-session-fork.test-fixture'
import { prepareStructuredAgentSessionFork } from '../structured-agent-session-fork'

let rig: RestTestRig
beforeEach(async () => {
  rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
})
afterEach(async () => rig.dispose())

it('refuses copying a work chat with a personal account request', async () => {
  const source = forkTestSource(rig, 'claude')
  source.record.claudeAccountId = 'work'
  await expect(
    prepareStructuredAgentSessionFork({
      host: source.host,
      sessionId: source.record.sessionId,
      throughItemId: 'legacy:codex:source:selected-response',
      agent: 'claude',
      claudeAccountId: 'personal',
      location: source.record.location,
      envelope: source.intent.envelope
    })
  ).rejects.toThrow('The requested account does not belong to the source session.')
})

it('preserves the explicit account in an independent copy', async () => {
  const source = forkTestSource(rig, 'claude')
  source.record.claudeAccountId = 'work'
  expect(await source.prepare()).toMatchObject({ claudeAccountId: 'work' })
})

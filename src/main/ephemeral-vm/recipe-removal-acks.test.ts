import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimRecipeRemovalAck,
  confirmRecipeRemovalAck,
  consumeRecipeRemovalAck,
  issueRecipeRemovalAck,
  releaseRecipeRemovalClaim,
  revokeRecipeRemovalAck
} from './recipe-removal-acks'

const binding = {
  hostId: 'runtime:env-a',
  workspaceId: 'repo::/workspace/repo-task',
  runtimeId: 'vm-a',
  runtimeCreatedAt: 10
}
const runtime = {
  id: 'vm-a',
  createdAt: 10,
  hostIds: ['runtime:env-a'],
  workspaceId: 'repo::/workspace/repo-task'
}

afterEach(() => {
  vi.useRealTimers()
})

describe('recipe removal acknowledgements', () => {
  it('spends a clean ack once', () => {
    const ack = issueRecipeRemovalAck(binding, true)
    expect(() => consumeRecipeRemovalAck(ack, runtime)).not.toThrow()
    expect(() => consumeRecipeRemovalAck(ack, runtime)).toThrow('not confirmed')
  })

  it('an unsafe answer authorizes nothing until the user confirms, and cancel revokes it', () => {
    const pending = issueRecipeRemovalAck(binding, false)
    expect(() => consumeRecipeRemovalAck(pending, runtime)).toThrow('not confirmed')
    expect(claimRecipeRemovalAck(pending, binding)).toEqual({ ok: false, reason: 'unconfirmed' })
    expect(confirmRecipeRemovalAck(pending)).toBe(true)
    expect(() => consumeRecipeRemovalAck(pending, runtime)).not.toThrow()

    const cancelled = issueRecipeRemovalAck(binding, false)
    revokeRecipeRemovalAck(cancelled)
    expect(confirmRecipeRemovalAck(cancelled)).toBe(false)
    expect(() => consumeRecipeRemovalAck(cancelled, runtime)).toThrow('not confirmed')
  })

  it('refuses a missing or expired ack; a claim holds it for the whole removal', () => {
    expect(() => consumeRecipeRemovalAck('', runtime)).toThrow('not confirmed')
    vi.useFakeTimers({ toFake: ['Date'] })
    const expired = issueRecipeRemovalAck(binding, true)
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1)
    expect(claimRecipeRemovalAck(expired, binding)).toEqual({ ok: false, reason: 'unconfirmed' })

    const claimed = issueRecipeRemovalAck(binding, true)
    expect(claimRecipeRemovalAck(claimed, binding)).toEqual({ ok: true })
    // Checkout removal and its polling can take long; only the destroy or a release ends a claim.
    vi.setSystemTime(Date.now() + 59 * 60_000)
    expect(() => consumeRecipeRemovalAck(claimed, runtime)).not.toThrow()
  })

  it('cancelling a decision revokes the claim already made from it', () => {
    const ack = issueRecipeRemovalAck(binding, false)
    expect(confirmRecipeRemovalAck(ack)).toBe(true)
    expect(claimRecipeRemovalAck(ack, binding)).toEqual({ ok: true })
    revokeRecipeRemovalAck(ack)
    expect(claimRecipeRemovalAck('', binding)).toEqual({ ok: false, reason: 'unconfirmed' })
    expect(() => consumeRecipeRemovalAck('', runtime)).toThrow('not confirmed')
  })

  it('a removal that failed after its claim releases it', () => {
    const ack = issueRecipeRemovalAck(binding, true)
    expect(claimRecipeRemovalAck(ack, binding)).toEqual({ ok: true })
    releaseRecipeRemovalClaim(binding.hostId, binding.workspaceId)
    expect(() => consumeRecipeRemovalAck('', runtime)).toThrow('not confirmed')
  })

  it('refuses an ack issued for another runtime instance, host or workspace', () => {
    // A replacement record under the same id was created later than the one that was checked.
    const replaced = issueRecipeRemovalAck(binding, true)
    expect(claimRecipeRemovalAck(replaced, { ...binding, runtimeCreatedAt: 11 })).toEqual({
      ok: false,
      reason: 'replaced'
    })
    expect(() => consumeRecipeRemovalAck(replaced, { ...runtime, createdAt: 11 })).toThrow(
      'not confirmed'
    )
    const otherHost = issueRecipeRemovalAck({ ...binding, hostId: 'runtime:env-b' }, true)
    expect(() => consumeRecipeRemovalAck(otherHost, runtime)).toThrow('not confirmed')
    const otherWorkspace = issueRecipeRemovalAck({ ...binding, workspaceId: 'repo::/other' }, true)
    expect(() => consumeRecipeRemovalAck(otherWorkspace, runtime)).toThrow('not confirmed')
  })
})

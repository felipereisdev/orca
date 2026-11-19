import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeRecipeRemovalAck, issueRecipeRemovalAck } from './recipe-removal-acks'

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
  it('spends a valid ack once', () => {
    const ack = issueRecipeRemovalAck(binding)
    expect(() => consumeRecipeRemovalAck(ack, runtime)).not.toThrow()
    expect(() => consumeRecipeRemovalAck(ack, runtime)).toThrow('not confirmed')
  })

  it('refuses a missing or expired ack', () => {
    expect(() => consumeRecipeRemovalAck('', runtime)).toThrow('not confirmed')
    vi.useFakeTimers({ toFake: ['Date'] })
    const ack = issueRecipeRemovalAck(binding)
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1)
    expect(() => consumeRecipeRemovalAck(ack, runtime)).toThrow('not confirmed')
  })

  it('refuses an ack issued for another runtime instance, host or workspace', () => {
    // A replacement record under the same id was created later than the one that was checked.
    const replaced = issueRecipeRemovalAck(binding)
    expect(() => consumeRecipeRemovalAck(replaced, { ...runtime, createdAt: 11 })).toThrow(
      'not confirmed'
    )
    const otherHost = issueRecipeRemovalAck({ ...binding, hostId: 'runtime:env-b' })
    expect(() => consumeRecipeRemovalAck(otherHost, runtime)).toThrow('not confirmed')
    const otherWorkspace = issueRecipeRemovalAck({ ...binding, workspaceId: 'repo::/other' })
    expect(() => consumeRecipeRemovalAck(otherWorkspace, runtime)).toThrow('not confirmed')
  })
})

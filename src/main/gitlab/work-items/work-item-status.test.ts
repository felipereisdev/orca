import { describe, expect, it, vi } from 'vitest'

const glabExecFileAsync = vi.hoisted(() => vi.fn())
vi.mock('../../git/command-runner/hosted-cli/glab-exec-file', () => ({ glabExecFileAsync }))

import { getWorkItemStatuses } from './work-item-status'

describe('getWorkItemStatuses', () => {
  it('answers null instead of failing when glab rejects the GraphQL read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    glabExecFileAsync.mockRejectedValue(new Error('timed out'))

    await expect(
      getWorkItemStatuses('/src/app', { host: 'git.example.com', path: 'acme/app' }, [7])
    ).resolves.toBeNull()
  })
})

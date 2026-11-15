import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GlabRequestAdmissionModule from '../requests/glab-request-admission'

const { glabExecFileAsyncMock } = vi.hoisted(() => ({ glabExecFileAsyncMock: vi.fn() }))

vi.mock('../../git/command-runner/hosted-cli/glab-exec-file', () => ({
  glabExecFileAsync: glabExecFileAsyncMock
}))

vi.mock('../requests/glab-request-admission', async (importOriginal) => ({
  ...(await importOriginal<typeof GlabRequestAdmissionModule>()),
  acquire: vi.fn(async () => {}),
  release: vi.fn()
}))

import { addIssueComment } from './gitlab-issue-queries'

describe('addIssueComment', () => {
  beforeEach(() => {
    glabExecFileAsyncMock.mockReset()
  })

  it("returns a posted note as the viewer's own", async () => {
    glabExecFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: 77,
        author: { username: 'someone' },
        body: 'Reply',
        created_at: '2026-11-14T12:00:00Z'
      })
    })

    // A caller that appends this copy without a re-read must never count it as someone else's.
    await expect(
      addIssueComment('/repo-root', 12, 'Reply', undefined, null, {
        host: 'gitlab.com',
        path: 'team/app'
      })
    ).resolves.toMatchObject({ ok: true, comment: { id: 77, viewerDidAuthor: true } })
  })
})

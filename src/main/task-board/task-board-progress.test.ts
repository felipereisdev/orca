import { describe, expect, it } from 'vitest'
import type { HostedReviewInfo } from '../../shared/source-control/hosted-review/hosted-review-contracts'
import { readTaskBoardProgress, type TaskBoardProgressDeps } from './task-board-progress'
import type { TaskBoardWorkspaceCandidate } from './task-board-workspace-match'

function review(number: number, status: HostedReviewInfo['status']): HostedReviewInfo {
  return {
    provider: 'gitlab',
    number,
    title: 'Fix refunds',
    state: 'open',
    url: `https://gitlab.com/acme/app/-/merge_requests/${number}`,
    status,
    updatedAt: '2026-11-14T10:00:00Z',
    mergeable: 'MERGEABLE'
  }
}

// Mimics the hosted-review cache: only a forced user refresh sees the MR opened since the last read.
const deps: TaskBoardProgressDeps = {
  commitsAhead: async () => 3,
  hostedReview: async ({ force, userRefresh }) =>
    force && userRefresh ? review(42, 'failure') : null
}

const worktree: TaskBoardWorkspaceCandidate = {
  worktreeId: 'repo-1::/src/refunds',
  repoId: 'repo-1',
  path: '/src/refunds',
  isGitRepo: true,
  branch: 'fix/refunds',
  lastActivityAt: 1,
  attachments: []
}

describe('readTaskBoardProgress', () => {
  it('reads past the hosted-review cache on a fresh read', async () => {
    await expect(readTaskBoardProgress(worktree, { fresh: false }, deps)).resolves.toEqual({
      worktreeId: 'repo-1::/src/refunds',
      branch: 'fix/refunds',
      commitsAhead: 3,
      review: null,
      checks: 'none'
    })
    await expect(readTaskBoardProgress(worktree, { fresh: true }, deps)).resolves.toEqual({
      worktreeId: 'repo-1::/src/refunds',
      branch: 'fix/refunds',
      commitsAhead: 3,
      review: {
        number: 42,
        url: 'https://gitlab.com/acme/app/-/merge_requests/42',
        state: 'open'
      },
      checks: 'failure'
    })
  })

  it('reports a folder workspace without commits or review, since it has no git', async () => {
    const folder = { ...worktree, worktreeId: 'folder:notes', isGitRepo: false, branch: null }

    await expect(readTaskBoardProgress(folder, { fresh: true }, deps)).resolves.toEqual({
      worktreeId: 'folder:notes',
      branch: null,
      commitsAhead: null,
      review: null,
      checks: 'none'
    })
  })
})

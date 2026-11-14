import type { CheckStatus } from '../../shared/github/pull-requests/pull-request-types'
import type { HostedReviewInfo } from '../../shared/source-control/hosted-review/hosted-review-contracts'
import type {
  TaskBoardChecks,
  TaskBoardProgress
} from '../../shared/task-board/task-board-wire-types'
import type { TaskBoardWorkspaceCandidate } from './task-board-workspace-match'

export type TaskBoardHostedReviewRequest = {
  workspace: TaskBoardWorkspaceCandidate & { branch: string }
  /** Both set on fresh reads so the hosted-review cache and its pacing are skipped. */
  force: boolean
  userRefresh: boolean
}

export type TaskBoardProgressDeps = {
  /** Commits on the workspace's branch ahead of its compare base; null when git cannot tell. */
  commitsAhead(workspace: TaskBoardWorkspaceCandidate): Promise<number | null>
  hostedReview(request: TaskBoardHostedReviewRequest): Promise<HostedReviewInfo | null>
}

const CHECKS_BY_STATUS: Record<CheckStatus, TaskBoardChecks> = {
  success: 'success',
  failure: 'failure',
  pending: 'pending',
  // Providers report neutral when a review has no resolvable checks.
  neutral: 'none'
}

export async function readTaskBoardProgress(
  workspace: TaskBoardWorkspaceCandidate,
  options: { fresh: boolean },
  deps: TaskBoardProgressDeps
): Promise<TaskBoardProgress> {
  const progress = { worktreeId: workspace.worktreeId, branch: workspace.branch }
  if (!workspace.isGitRepo) {
    return { ...progress, commitsAhead: null, review: null, checks: 'none' }
  }
  const { branch } = workspace
  const [commitsAhead, review] = await Promise.all([
    deps.commitsAhead(workspace),
    branch
      ? deps.hostedReview({
          workspace: { ...workspace, branch },
          force: options.fresh,
          userRefresh: options.fresh
        })
      : Promise.resolve(null)
  ])
  return {
    ...progress,
    commitsAhead,
    review: review ? { number: review.number, url: review.url, state: review.state } : null,
    checks: review ? CHECKS_BY_STATUS[review.status] : 'none'
  }
}

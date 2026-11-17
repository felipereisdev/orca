import { getRepoRoutingConnectionId } from '../../shared/execution-host/execution-host'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import { selectGitLabMoveStatus } from '../../shared/task-board/task-board-move-targets'
import type { TaskBoardCardRef } from '../../shared/task-board/task-board-wire-types'
import type { BoardTarget, MovePlan, TaskBoardMoveDeps } from './task-board-host-move'

/** A card with a Status moves by Status alone; GitLab closes/reopens for done/canceled statuses. */
export async function planGitLabStatusMove(
  ref: Extract<TaskBoardCardRef, { provider: 'gitlab' }>,
  card: TaskBoardCard,
  target: BoardTarget,
  deps: TaskBoardMoveDeps
): Promise<MovePlan> {
  const repo = deps.repo(ref.repoId)
  if (!repo) {
    throw new Error(`Repository ${ref.repoId} is no longer on this host`)
  }
  const projectRef =
    (card.source.provider === 'gitlab' ? card.source.item.projectRef : null) ?? ref.projectRef
  if (!projectRef) {
    throw new Error(`The GitLab project of issue #${ref.number} is unknown`)
  }
  const connectionId = getRepoRoutingConnectionId(repo)
  const localGit = deps.getLocalGitArgs(repo)[0] ?? {}
  const statusTarget = await deps.gitlabWorkItemStatusTarget(
    repo.path,
    projectRef,
    ref.number,
    connectionId,
    localGit
  )
  if (!statusTarget) {
    throw new Error(`GitLab did not return the statuses of issue #${ref.number}`)
  }
  const status = selectGitLabMoveStatus(
    card,
    statusTarget.lifecycle,
    target.columnId,
    target.columns,
    target.settings
  )
  if (!status) {
    return { stop: { status: 'blocked', reason: 'no-mapping' } }
  }
  return {
    write: () =>
      deps.updateGitLabWorkItemStatus(
        repo.path,
        projectRef,
        statusTarget.workItemId,
        status.id,
        connectionId,
        localGit
      )
  }
}

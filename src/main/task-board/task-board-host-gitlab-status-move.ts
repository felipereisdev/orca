import { getRepoRoutingConnectionId } from '../../shared/execution-host/execution-host'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import { selectGitLabMoveStatus } from '../../shared/task-board/task-board-move-targets'
import { withGitLabWorkItemStatus } from '../../shared/task-board/task-board-provider-cards'
import type { TaskBoardCardRef } from '../../shared/task-board/task-board-wire-types'
import type { GitLabWorkItemStatusTarget } from '../gitlab/work-items/work-item-status-response'
import { readTaskBoardCard } from './task-board-host-card'
import type { BoardTarget, MovePlan, TaskBoardMoveDeps } from './task-board-host-move'

type GitLabRef = Extract<TaskBoardCardRef, { provider: 'gitlab' }>

function gitLabWriteTarget(ref: GitLabRef, card: TaskBoardCard, deps: TaskBoardMoveDeps) {
  const repo = deps.repo(ref.repoId)
  if (!repo) {
    throw new Error(`Repository ${ref.repoId} is no longer on this host`)
  }
  const projectRef =
    (card.source.provider === 'gitlab' ? card.source.item.projectRef : null) ?? ref.projectRef
  return {
    repo,
    projectRef,
    connectionId: getRepoRoutingConnectionId(repo),
    localGit: deps.getLocalGitArgs(repo)[0] ?? {}
  }
}

/** The card a move starts from. A GitLab card takes its Status from the one read the move plan
 *  also uses; a failed read throws, so a project with statuses never falls back to labels. */
export async function readTaskBoardMoveCard(
  ref: TaskBoardCardRef,
  deps: TaskBoardMoveDeps
): Promise<{ card: TaskBoardCard; statusTarget: GitLabWorkItemStatusTarget | null }> {
  if (ref.provider !== 'gitlab') {
    return { card: await readTaskBoardCard(ref, deps), statusTarget: null }
  }
  const card = await readTaskBoardCard(ref, deps, { workItemStatus: 'skip' })
  const { repo, projectRef, connectionId, localGit } = gitLabWriteTarget(ref, card, deps)
  if (!projectRef) {
    return { card, statusTarget: null }
  }
  const read = await deps.gitlabWorkItemStatusTarget(
    repo.path,
    projectRef,
    ref.number,
    connectionId,
    localGit
  )
  if (read.kind === 'failed') {
    throw new Error(read.error)
  }
  if (read.kind === 'unsupported' || !read.target.status) {
    return { card, statusTarget: null }
  }
  return {
    card: withGitLabWorkItemStatus(card, read.target.status),
    statusTarget: read.target
  }
}

/** A card with a Status moves by Status alone; GitLab closes/reopens for done/canceled statuses. */
export function planGitLabStatusMove(
  ref: GitLabRef,
  card: TaskBoardCard,
  statusTarget: GitLabWorkItemStatusTarget,
  target: BoardTarget,
  deps: TaskBoardMoveDeps
): MovePlan {
  const { repo, projectRef, connectionId, localGit } = gitLabWriteTarget(ref, card, deps)
  const status = selectGitLabMoveStatus(
    card,
    statusTarget.lifecycle,
    target.columnId,
    target.columns,
    target.settings
  )
  if (!status || !projectRef) {
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

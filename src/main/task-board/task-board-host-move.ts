import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import {
  classifyTransitionRequirements,
  jiraTransitionChoice,
  jiraTransitionUpdate
} from '../../shared/jira/jira-transition-fields'
import type {
  JiraIssueUpdate,
  JiraMutationResult,
  JiraTransition
} from '../../shared/jira/jira-types'
import type { LinearWorkflowState } from '../../shared/linear/workspace-types'
import type { Repo } from '../../shared/repo-types'
import type { TaskBoardCard } from '../../shared/task-board/task-board-card'
import { resolveTaskBoardColumnId } from '../../shared/task-board/task-board-columns'
import {
  resolveLabelProviderMove,
  selectJiraMoveTransitions,
  selectLinearMoveStates
} from '../../shared/task-board/task-board-move-targets'
import type { TaskBoardSettings } from '../../shared/task-board/task-board-settings'
import type {
  TaskBoardCardRef,
  TaskBoardChoice,
  TaskBoardMoveFields,
  TaskBoardMoveResult
} from '../../shared/task-board/task-board-wire-types'
import type { WorkspaceStatusDefinition } from '../../shared/worktree/types'
import type { updateIssue as updateGitHubIssue } from '../github/issues/issue-update'
import type { updateIssue as updateGitLabIssue } from '../gitlab/issues/issue-update'
import { invalidateTaskBoardCardCaches, type TaskBoardEnrichCaches } from './task-board-enrich'
import {
  readTaskBoardCard,
  taskBoardRefKeyForRef,
  type TaskBoardCardReadDeps
} from './task-board-host-card'
import { placeTaskBoardCard, type TaskBoardHostDeps } from './task-board-host-list'
import { taskBoardErrorMessage } from './task-board-provider-errors'

type RepoRef = Extract<TaskBoardCardRef, { provider: 'gitlab' | 'github' }>
type ProviderWrite = { ok: true } | { ok: false; error: string }

export type TaskBoardMoveWriteDeps = {
  jiraTransitions(key: string, siteId: string | null): Promise<JiraTransition[]>
  updateJiraIssue(
    key: string,
    updates: JiraIssueUpdate,
    siteId: string | null
  ): Promise<JiraMutationResult>
  linearTeamStates(teamId: string, workspaceId: string | null): Promise<LinearWorkflowState[]>
  updateLinearIssue(
    id: string,
    updates: { stateId: string },
    workspaceId: string | null
  ): Promise<ProviderWrite>
  /** The labels of the issue's own project/repository; [] when unreadable. */
  repoLabels(ref: RepoRef, repo: Repo): Promise<string[]>
  updateGitLabIssue: typeof updateGitLabIssue
  updateGitHubIssue: typeof updateGitHubIssue
}

export type TaskBoardMoveDeps = TaskBoardCardReadDeps &
  TaskBoardMoveWriteDeps & {
    host: Pick<TaskBoardHostDeps, 'settings' | 'statuses'>
    caches: TaskBoardEnrichCaches
  }

export type TaskBoardMoveParams = {
  ref: TaskBoardCardRef
  targetColumnId: string
  choiceId?: string
  fields?: TaskBoardMoveFields
}

type MoveStop = Extract<
  TaskBoardMoveResult,
  { status: 'needs-choice' | 'needs-fields' | 'unsupported-fields' | 'blocked' }
>

export type JiraMoveDecision =
  | {
      kind: 'apply'
      transitionId: string
      transitionFields?: Record<string, unknown>
      transitionComment?: string
    }
  | MoveStop

/** The candidate the user chose; never one outside the requested column's candidates. */
function chooseCandidate<T extends { id: string }>(
  candidates: readonly T[],
  choiceId: string | undefined,
  describe: (candidate: T) => TaskBoardChoice
): { candidate: T } | { stop: MoveStop } {
  if (candidates.length === 0) {
    return { stop: { status: 'blocked', reason: 'no-transition' } }
  }
  if (choiceId !== undefined) {
    const chosen = candidates.find((candidate) => candidate.id === choiceId)
    return chosen
      ? { candidate: chosen }
      : { stop: { status: 'blocked', reason: 'invalid-choice' } }
  }
  if (candidates.length > 1) {
    return { stop: { status: 'needs-choice', choices: candidates.map(describe) } }
  }
  return { candidate: candidates[0] }
}

export function decideJiraMove(
  candidates: readonly JiraTransition[],
  params: { choiceId?: string; fields?: TaskBoardMoveFields }
): JiraMoveDecision {
  const picked = chooseCandidate(candidates, params.choiceId, jiraTransitionChoice)
  if ('stop' in picked) {
    return picked.stop
  }
  const transition = picked.candidate
  if (classifyTransitionRequirements(transition).kind === 'unsupported') {
    return { status: 'unsupported-fields', choice: jiraTransitionChoice(transition) }
  }
  const update = jiraTransitionUpdate(transition, params.fields)
  return update
    ? { kind: 'apply', ...update, transitionId: transition.id }
    : { status: 'needs-fields', choice: jiraTransitionChoice(transition) }
}

type BoardTarget = {
  columnId: string
  columns: readonly WorkspaceStatusDefinition[]
  settings: TaskBoardSettings
}
type MovePlan = { write: () => Promise<ProviderWrite> } | { stop: MoveStop }

async function planJiraMove(
  ref: Extract<TaskBoardCardRef, { provider: 'jira' }>,
  params: TaskBoardMoveParams,
  target: BoardTarget,
  deps: TaskBoardMoveDeps
): Promise<MovePlan> {
  const transitions = await deps.jiraTransitions(ref.key, ref.siteId)
  const decision = decideJiraMove(
    selectJiraMoveTransitions(transitions, target.columnId, target.columns, target.settings),
    params
  )
  if (!('kind' in decision)) {
    return { stop: decision }
  }
  const { kind: _kind, ...updates } = decision
  return { write: () => deps.updateJiraIssue(ref.key, updates, ref.siteId) }
}

async function planLinearMove(
  ref: Extract<TaskBoardCardRef, { provider: 'linear' }>,
  params: TaskBoardMoveParams,
  target: BoardTarget,
  deps: TaskBoardMoveDeps
): Promise<MovePlan> {
  const states = await deps.linearTeamStates(ref.teamId, ref.workspaceId)
  const picked = chooseCandidate(
    selectLinearMoveStates(states, target.columnId, target.columns, target.settings),
    params.choiceId,
    (state) => ({ id: state.id, name: state.name, fields: null })
  )
  if ('stop' in picked) {
    return picked
  }
  const stateId = picked.candidate.id
  return { write: () => deps.updateLinearIssue(ref.id, { stateId }, ref.workspaceId) }
}

async function planLabelMove(
  ref: RepoRef,
  card: TaskBoardCard,
  target: BoardTarget,
  deps: TaskBoardMoveDeps
): Promise<MovePlan> {
  const repo = deps.repo(ref.repoId)
  if (!repo) {
    throw new Error(`Repository ${ref.repoId} is no longer on this host`)
  }
  const resolve = (knownLabels?: readonly string[]) =>
    resolveLabelProviderMove(card, target.columnId, target.columns, target.settings, knownLabels)
  let resolved = resolve()
  // An added label takes the casing the repo already uses, so a rule never creates a case variant.
  if (resolved.ok && resolved.addLabels.length > 0) {
    resolved = resolve(await deps.repoLabels(ref, repo).catch(() => []))
  }
  if (!resolved.ok) {
    return { stop: { status: 'blocked', reason: resolved.reason } }
  }
  const { state, addLabels, removeLabels } = resolved
  const connectionId = getRepoRoutingConnectionId(repo)
  const localGit = deps.getLocalGitArgs(repo)[0] ?? {}
  // Writes go to the issue's own project/repository, never the checkout's current source.
  if (ref.provider === 'gitlab') {
    const updates = {
      ...(state ? { state: state === 'open' ? ('opened' as const) : ('closed' as const) } : {}),
      addLabels,
      removeLabels
    }
    return {
      write: () =>
        deps.updateGitLabIssue(
          repo.path,
          ref.number,
          updates,
          repo.issueSourcePreference,
          connectionId,
          ref.projectRef,
          localGit
        )
    }
  }
  const updates = { ...(state ? { state } : {}), addLabels, removeLabels }
  return {
    write: () =>
      deps.updateGitHubIssue(
        repo.path,
        ref.number,
        updates,
        connectionId,
        localGit,
        repo.issueSourcePreference,
        ref.issueRepo
      )
  }
}

function planMove(
  params: TaskBoardMoveParams,
  card: TaskBoardCard,
  target: BoardTarget,
  deps: TaskBoardMoveDeps
): Promise<MovePlan> {
  const { ref } = params
  switch (ref.provider) {
    case 'jira':
      return planJiraMove(ref, params, target, deps)
    case 'linear':
      return planLinearMove(ref, params, target, deps)
    case 'gitlab':
    case 'github':
      return planLabelMove(ref, card, target, deps)
  }
}

/** Moves the card with the host's rules; `moved` means the provider confirmed the write. */
export async function moveTaskBoardCard(
  params: TaskBoardMoveParams,
  deps: TaskBoardMoveDeps
): Promise<TaskBoardMoveResult> {
  const columns = deps.host.statuses()
  const { taskBoard: settings } = deps.host.settings()
  if (!columns.some((column) => column.id === params.targetColumnId)) {
    return { status: 'blocked', reason: 'no-mapping' }
  }
  const target = { columnId: params.targetColumnId, columns, settings }
  let refKey: string
  let write: () => Promise<ProviderWrite>
  try {
    // Keyed before the write, so a confirmed move never ends as an RPC error.
    refKey = taskBoardRefKeyForRef(params.ref, deps)
    // The provider's current state, not the client's possibly stale card, decides the move.
    const card = await readTaskBoardCard(params.ref, deps)
    if (resolveTaskBoardColumnId(card, columns, settings) === params.targetColumnId) {
      return { status: 'blocked', reason: 'same-column' }
    }
    const plan = await planMove(params, card, target, deps)
    if ('stop' in plan) {
      return plan.stop
    }
    write = plan.write
  } catch (error) {
    return { status: 'failed', error: taskBoardErrorMessage(error) }
  }
  let written: ProviderWrite
  try {
    written = await write()
  } catch (error) {
    return { status: 'failed', error: taskBoardErrorMessage(error) }
  }
  if (!written.ok) {
    return { status: 'failed', error: written.error }
  }
  invalidateTaskBoardCardCaches(deps.caches, refKey)
  try {
    const moved = await readTaskBoardCard(params.ref, deps)
    return { status: 'moved', card: placeTaskBoardCard(moved, columns, settings) }
  } catch {
    // Applied but unread: the client keeps the card where it dropped it and re-lists.
    return { status: 'moved', card: null }
  }
}

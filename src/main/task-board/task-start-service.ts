import type { z } from 'zod'
import { getRepoSshConnectionId } from '../../shared/execution-host/execution-host'
import type { Repo } from '../../shared/repository/repo-types'
import type { TaskBoardStartTaskParams } from '../../shared/rpc-contract/task-board/task-board-params'
import type {
  TaskBoardCardRef,
  TaskStartPrimaryReason,
  TaskStartResult
} from '../../shared/task-board/task-board-wire-types'
import type {
  TaskStartContext,
  TaskStartImage
} from '../../shared/task-board/task-start-context-types'
import { buildTaskStartPrompt, taskStartTabTitle } from '../../shared/task-board/task-start-prompt'
import {
  resolveTaskStartRoles,
  resolveTaskStartWorkspaceMode,
  TASK_START_ROLES
} from '../../shared/task-board/task-start-settings'
import type { StopMutation } from '../runtime/rpc/methods/orchestration/worker/stop/single-worker-stop'
import type { TaskStartCard } from './task-start-context'
import type { TaskStartLifecycleDeps } from './task-start-lifecycle'
import {
  buildTaskStartAgentCatalog,
  invalidTaskStartRoles,
  resolveTaskStartRepoForParams,
  taskStartRoleLabels,
  type TaskStartOptionsDeps
} from './task-start-options'
import {
  createTaskStartRunGuard,
  refuseTaskStart as refuse,
  type TaskStartRunGuard
} from './task-start-service-guard'
import { launchTaskStartOrchestrator, type TaskStartLaunchDeps } from './task-start-service-launch'
import { moveStartedCard, type TaskStartMoveDeps } from './task-start-service-move'
import type { TaskStartStopDeps } from './task-start-stop'
import {
  openTaskStartWorkspace,
  resolveTaskStartBase,
  type TaskStartWorkspaceDeps
} from './task-start-workspace'

export type TaskStartParams = z.infer<typeof TaskBoardStartTaskParams>

export type TaskStartServiceDeps = TaskStartLaunchDeps &
  TaskStartMoveDeps &
  TaskStartWorkspaceDeps & {
    options: TaskStartOptionsDeps
    /** What ⏹ ends, for a start a stop cancels after its orchestrator was published. */
    orchestration: TaskStartStopDeps['orchestration']
    stopMutation(): StopMutation
    lifecycle: TaskStartLifecycleDeps
    /** The card's board key; throws when its repo left this host. */
    cardKey(ref: TaskBoardCardRef): string
    /** The card and its context; throws when the item cannot be read. */
    readContext(ref: TaskBoardCardRef): Promise<{ card: TaskStartCard; context: TaskStartContext }>
    /** Images saved on the orchestrator's host; a failed one keeps its URL. */
    writeImages(args: {
      card: TaskStartCard
      repo: Repo
      runId: string
      images: TaskStartImage[]
    }): Promise<TaskStartImage[]>
    gitStatus(worktreeId: string): Promise<{ entries: readonly unknown[]; branch?: string }>
  }

// Remotes a configured base usually names; anything else must match the branch exactly.
const BASE_REMOTE = /^(?:refs\/remotes\/)?(?:origin|upstream)\//

/** A base like `origin/main` names the branch `main`. */
function isBaseBranch(branch: string, base: string): boolean {
  const name = branch.replace(/^refs\/heads\//, '')
  const baseName = base.replace(/^refs\/heads\//, '')
  return name === baseName || name === baseName.replace(BASE_REMOTE, '')
}

async function primaryReasons(
  repo: Repo,
  base: string | null,
  deps: TaskStartServiceDeps
): Promise<{ worktreeId: string; reasons: TaskStartPrimaryReason[] }> {
  const worktreeId = await deps.primaryWorktreeId(repo)
  const status = await deps.gitStatus(`id:${worktreeId}`)
  const reasons: TaskStartPrimaryReason[] = []
  if (status.entries.length > 0) {
    reasons.push('uncommitted')
  }
  if (base && status.branch && !isBaseBranch(status.branch, base)) {
    reasons.push('other-branch')
  }
  return { worktreeId, reasons }
}

type Prepared = {
  repo: Repo
  cardKey: string
  workspaceMode: 'worktree' | 'primary'
  /** Null for folder repos and repos without a resolvable base. */
  base: string | null
  primaryWorktreeId?: string
  roles: NonNullable<ReturnType<typeof resolveTaskStartRoles>>
  labels: ReturnType<typeof taskStartRoleLabels>
}

/** Steps without effects: repo, roles against this host's catalog, and the primary checkout. */
async function prepare(
  params: TaskStartParams,
  deps: TaskStartServiceDeps
): Promise<Prepared | TaskStartResult> {
  const { options } = deps
  const repos = options.repos()
  const resolution = await resolveTaskStartRepoForParams(params, repos, options)
  const repo = repos.find((candidate) => candidate.id === resolution.repoId)
  if (!repo) {
    return refuse('repo_unresolved')
  }
  let cardKey: string
  try {
    cardKey = deps.cardKey(params.ref)
  } catch {
    return refuse('repo_unresolved')
  }
  const settings = options.settings()
  const roles = resolveTaskStartRoles({
    global: settings.taskStart,
    repo: repo.taskStart,
    defaultAgent: settings.defaultTuiAgent,
    overrides: params.roles
  })
  if (!roles) {
    // Only the orchestrator has no fallback: every other role falls back to it.
    return refuse('agent_unavailable', null, { role: 'orchestrator' })
  }
  // The settings list this machine's providers; an SSH project runs the remote's own login.
  if (getRepoSshConnectionId(repo) !== null) {
    const remoteAccount = TASK_START_ROLES.find((role) => roles[role].accountId !== undefined)
    if (remoteAccount) {
      return refuse('remote_account_unsupported', null, { role: remoteAccount })
    }
  }
  const catalog = await buildTaskStartAgentCatalog(repo, options)
  const [unavailable] = invalidTaskStartRoles(roles, catalog)
  if (unavailable) {
    return refuse('agent_unavailable', null, { role: unavailable })
  }
  const signInNeeded = TASK_START_ROLES.find((role) =>
    catalog.some(
      (entry) =>
        entry.needsSignIn &&
        entry.agent === roles[role].agent &&
        entry.accountId === roles[role].accountId
    )
  )
  if (signInNeeded) {
    return refuse('account_needs_sign_in', null, { role: signInNeeded })
  }
  const workspaceMode = resolveTaskStartWorkspaceMode(repo, params.workspaceMode)
  const accounts = new Map(options.claudeAccounts().map((account) => [account.id, account]))
  // Folder repos never consult git.
  const isGit = repo.kind !== 'folder'
  const prepared: Prepared = {
    repo,
    cardKey,
    workspaceMode,
    base: isGit ? await resolveTaskStartBase(repo, params.baseRef, deps) : null,
    roles,
    labels: taskStartRoleLabels(roles, accounts)
  }
  if (workspaceMode === 'primary' && isGit) {
    const primary = await primaryReasons(repo, prepared.base, deps).catch((error: unknown) => {
      console.warn('[task-start] reading the primary checkout failed', error)
      return null
    })
    if (!primary) {
      return refuse('primary_status_failed')
    }
    if (primary.reasons.length > 0 && params.confirmPrimary !== true) {
      return refuse('primary_needs_confirmation', null, { reasons: primary.reasons })
    }
    prepared.primaryWorktreeId = primary.worktreeId
  }
  return prepared
}

async function runStart(
  prepared: Prepared,
  params: TaskStartParams,
  guard: TaskStartRunGuard,
  deps: TaskStartServiceDeps
): Promise<TaskStartResult> {
  const { repo } = prepared
  let card: TaskStartCard
  let context: TaskStartContext
  try {
    ;({ card, context } = await deps.readContext(params.ref))
    if (!guard.alive()) {
      return await guard.settle()
    }
    const images = await deps.writeImages({
      card,
      repo,
      runId: guard.runId,
      images: context.images
    })
    context = { ...context, images }
  } catch (error) {
    console.warn('[task-start] reading the card context failed', error)
    return guard.fail('context-fetch-failed', 'context_fetch_failed')
  }
  if (!guard.alive()) {
    return guard.settle()
  }
  const workspace = await openTaskStartWorkspace(prepared, card, guard, deps)
  if ('ok' in workspace) {
    return workspace
  }
  const { worktreeId } = workspace
  guard.worktreeId = worktreeId
  if (!guard.alive() || !guard.patch({ worktreeId, cardTitle: card.title })) {
    return guard.settle()
  }
  const prompt = buildTaskStartPrompt({
    context,
    roles: prepared.roles,
    labels: prepared.labels,
    userPrompt: params.userPrompt
  })
  return launchTaskStartOrchestrator(
    {
      repo,
      worktreeId,
      choice: prepared.roles.orchestrator,
      prompt,
      title: taskStartTabTitle('orchestrator', card.displayId)
    },
    guard,
    deps
  )
}

/** Starts the card's orchestrator: every effect happens after the atomic claim. */
export async function startTaskFromCard(
  params: TaskStartParams,
  deps: TaskStartServiceDeps
): Promise<TaskStartResult> {
  const prepared = await prepare(params, deps)
  if ('ok' in prepared) {
    return prepared
  }
  const { store } = deps.lifecycle
  const claimed = store.claim({
    cardKey: prepared.cardKey,
    repoId: prepared.repo.id,
    workspaceMode: prepared.workspaceMode,
    ...(prepared.workspaceMode === 'primary' ? { primaryKey: prepared.repo.id } : {})
  })
  if (!claimed.ok) {
    return refuse(claimed.reason)
  }
  const runId = claimed.run.id
  // Keeps listings from failing this pending run while the start is alive here.
  store.inFlight.add(runId)
  const guard = createTaskStartRunGuard(runId, deps)
  try {
    const result = await runStart(prepared, params, guard, deps)
    return result.ok
      ? await moveStartedCard(params.ref, prepared.cardKey, result, guard, deps)
      : result
  } catch (error) {
    console.warn('[task-start] start failed', error)
    return await guard.fail('launch-failed', 'launch_failed')
  } finally {
    store.inFlight.delete(runId)
  }
}

import type { z } from 'zod'
import type { Repo } from '../../shared/repo-types'
import type { TaskBoardStartTaskParams } from '../../shared/rpc-contract/task-board-params'
import type {
  TaskBoardCardRef,
  TaskStartError,
  TaskStartPrimaryReason,
  TaskStartResult
} from '../../shared/task-board/task-board-wire-types'
import type {
  TaskStartContext,
  TaskStartImage
} from '../../shared/task-board/task-start-context-types'
import { buildTaskStartPrompt } from '../../shared/task-board/task-start-prompt'
import {
  summarizeTaskStartRun,
  type TaskStartFailure,
  type TaskStartRun
} from '../../shared/task-board/task-start-run'
import {
  resolveTaskStartRoles,
  resolveTaskStartWorkspaceMode,
  TASK_START_ROLES
} from '../../shared/task-board/task-start-settings'
import type { TaskStartCard } from './task-start-context'
import { stopTaskStartWatcher, type TaskStartLifecycleDeps } from './task-start-lifecycle'
import {
  buildTaskStartAgentCatalog,
  invalidTaskStartRoles,
  resolveTaskStartRepoForParams,
  taskStartRoleLabels,
  type TaskStartOptionsDeps
} from './task-start-options'
import {
  launchTaskStartOrchestrator,
  type TaskStartLaunchDeps,
  type TaskStartRunGuard
} from './task-start-service-launch'

export type TaskStartParams = z.infer<typeof TaskBoardStartTaskParams>

export type TaskStartServiceDeps = TaskStartLaunchDeps & {
  options: TaskStartOptionsDeps
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
  primaryWorktreeId(repo: Repo): Promise<string>
  gitStatus(worktreeId: string): Promise<{ entries: readonly unknown[]; branch?: string }>
  /** A new worktree with the card's item linked. */
  createWorktree(args: {
    repo: Repo
    card: TaskStartCard
    baseBranch?: string
  }): Promise<{ worktreeId: string }>
}

const LIVE = ['running', 'waiting'] as const

function refuse(
  error: TaskStartError,
  run?: TaskStartRun | null,
  reasons?: TaskStartPrimaryReason[]
): TaskStartResult {
  return {
    ok: false,
    error,
    ...(reasons ? { reasons } : {}),
    ...(run ? { run: summarizeTaskStartRun(run) } : {})
  }
}

/** A base like `origin/main` names the branch `main`. */
function isBaseBranch(branch: string, base: string): boolean {
  const name = branch.replace(/^refs\/heads\//, '')
  return name === base || base.endsWith(`/${name}`)
}

async function primaryReasons(
  repo: Repo,
  params: TaskStartParams,
  deps: TaskStartServiceDeps
): Promise<{ worktreeId: string; reasons: TaskStartPrimaryReason[] }> {
  const worktreeId = await deps.primaryWorktreeId(repo)
  const status = await deps.gitStatus(`id:${worktreeId}`)
  const base =
    params.baseRef ??
    repo.worktreeBaseRef ??
    (await deps.options.baseRefDefault(repo).catch(() => null))
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
    return refuse('agent_unavailable')
  }
  const catalog = await buildTaskStartAgentCatalog(repo, options)
  if (invalidTaskStartRoles(roles, catalog).length > 0) {
    return refuse('agent_unavailable')
  }
  const signInNeeded = TASK_START_ROLES.some((role) =>
    catalog.some(
      (entry) =>
        entry.needsSignIn &&
        entry.agent === roles[role].agent &&
        entry.accountId === roles[role].accountId
    )
  )
  if (signInNeeded) {
    return refuse('account_needs_sign_in')
  }
  const workspaceMode = resolveTaskStartWorkspaceMode(repo, params.workspaceMode)
  const accounts = new Map(options.claudeAccounts().map((account) => [account.id, account]))
  const prepared: Prepared = {
    repo,
    cardKey,
    workspaceMode,
    roles,
    labels: taskStartRoleLabels(roles, accounts)
  }
  // Folder repos never consult git.
  if (workspaceMode === 'primary' && repo.kind !== 'folder') {
    const primary = await primaryReasons(repo, params, deps).catch(() => null)
    if (!primary) {
      return refuse('worktree_create_failed')
    }
    if (primary.reasons.length > 0 && params.confirmPrimary !== true) {
      return refuse('primary_needs_confirmation', null, primary.reasons)
    }
    prepared.primaryWorktreeId = primary.worktreeId
  }
  return prepared
}

function createGuard(runId: string, deps: TaskStartServiceDeps): TaskStartRunGuard {
  const { store } = deps.lifecycle
  return {
    runId,
    alive: () => {
      const state = store.getById(runId)?.state
      return state === 'running' || state === 'waiting'
    },
    patch: (patch) => store.transition(runId, [...LIVE], patch),
    fail: async (failure: TaskStartFailure, error: TaskStartError) => {
      const failed = store.transition(runId, [...LIVE], { state: 'failed', failure })
      return failed ? refuse(error, failed) : cancel(runId, deps)
    },
    cancel: (published) => cancel(runId, deps, published)
  }
}

/** A stop arrived mid-start: close what this start opened (never the worktree) and settle the stop. */
async function cancel(
  runId: string,
  deps: TaskStartServiceDeps,
  published?: Parameters<TaskStartRunGuard['cancel']>[0]
): Promise<TaskStartResult> {
  if (published) {
    await deps.closeOrchestrator(published).catch((error: unknown) => {
      console.warn('[task-start] closing a cancelled orchestrator failed', error)
    })
  }
  const { store } = deps.lifecycle
  stopTaskStartWatcher(store, runId)
  const stopped = store.transition(runId, ['stopping'], { state: 'stopped', failure: 'cancelled' })
  return refuse('cancelled', stopped ?? store.getById(runId))
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
    const images = await deps.writeImages({
      card,
      repo,
      runId: guard.runId,
      images: context.images
    })
    context = { ...context, images }
  } catch {
    return guard.fail('context-fetch-failed', 'context_fetch_failed')
  }
  if (!guard.alive()) {
    return guard.cancel()
  }
  let worktreeId: string
  try {
    worktreeId =
      prepared.workspaceMode === 'primary'
        ? (prepared.primaryWorktreeId ?? (await deps.primaryWorktreeId(repo)))
        : (
            await deps.createWorktree({
              repo,
              card,
              ...((params.baseRef ?? repo.worktreeBaseRef)
                ? { baseBranch: params.baseRef ?? repo.worktreeBaseRef }
                : {})
            })
          ).worktreeId
  } catch {
    return guard.fail('worktree-create-failed', 'worktree_create_failed')
  }
  if (!guard.alive() || !guard.patch({ worktreeId })) {
    return guard.cancel()
  }
  const prompt = buildTaskStartPrompt({ context, roles: prepared.roles, labels: prepared.labels })
  return launchTaskStartOrchestrator(
    { repo, worktreeId, choice: prepared.roles.orchestrator, prompt },
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
  const guard = createGuard(runId, deps)
  try {
    return await runStart(prepared, params, guard, deps)
  } catch (error) {
    console.warn('[task-start] start failed', error)
    return await guard.fail('launch-failed', 'launch_failed')
  } finally {
    store.inFlight.delete(runId)
  }
}

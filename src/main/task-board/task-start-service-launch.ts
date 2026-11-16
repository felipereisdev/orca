import type { AgentLaunchResult } from '../../shared/agent-launch/contracts/agent-launch-intent'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import type { AgentLaunchParams } from '../../shared/rpc-contract/agent-launch-params'
import type { TaskStartResult } from '../../shared/task-board/task-board-wire-types'
import {
  summarizeTaskStartRun,
  type TaskStartOrchestratorRef,
  type TaskStartRun
} from '../../shared/task-board/task-start-run'
import type { TaskStartAgentChoice } from '../../shared/task-board/task-start-settings'
import { parsePaneKey } from '../../shared/workspace-layout/stable-pane-id'
import { watchTaskStartOrchestrator, type TaskStartLifecycleDeps } from './task-start-lifecycle'
import type { TaskStartRunGuard } from './task-start-service-guard'

export type TaskStartLaunchDeps = {
  lifecycle: TaskStartLifecycleDeps
  /** `agent.launch` in process; `onSurfacePublished` fires before the prompt is delivered. */
  launchAgent(
    params: AgentLaunchParams,
    onSurfacePublished: (surface: AgentLaunchResult) => void
  ): Promise<AgentLaunchResult>
  /** The published terminal's pane and PTY, when the host can tell. */
  terminalIdentity(handle: string): { paneKey?: string; ptyId?: string }
  closeOrchestrator(ref: TaskStartOrchestratorRef): Promise<void>
  /** Names the orchestrator's tab or chat the way a user's rename does. */
  renameOrchestrator(ref: TaskStartOrchestratorRef, title: string): Promise<void>
}

const CONFIRMED_PROMPT = new Set(['journaled', 'handed-to-terminal'])

function orchestratorRef(
  surface: AgentLaunchResult,
  repo: Repo,
  choice: TaskStartAgentChoice,
  deps: TaskStartLaunchDeps
): TaskStartOrchestratorRef {
  const base = {
    // 'local' or 'ssh:<target>': the liveness probe reaches the host by this id.
    hostId: getRepoExecutionHostId(repo),
    agent: choice.agent,
    worktreeId: surface.worktreeId
  }
  const { outcome } = surface
  if (outcome.kind === 'structured') {
    return {
      ...base,
      surface: 'chat',
      sessionId: outcome.sessionId,
      handle: outcome.handle,
      ...(outcome.tabId ? { tabId: outcome.tabId } : {})
    }
  }
  let identity: { paneKey?: string; ptyId?: string } = {}
  try {
    identity = deps.terminalIdentity(outcome.handle)
  } catch {
    // Identity is evidence for the watcher, never a reason to lose the published surface.
  }
  const paneKey = outcome.paneKey ?? identity.paneKey
  const tabId = paneKey ? parsePaneKey(paneKey)?.tabId : undefined
  return {
    ...base,
    surface: 'terminal',
    handle: outcome.handle,
    ...(paneKey ? { paneKey } : {}),
    ...(tabId ? { tabId } : {}),
    ...(identity.ptyId ? { ptyId: identity.ptyId } : {})
  }
}

function launchParams(
  choice: TaskStartAgentChoice,
  runId: string,
  worktreeId: string,
  prompt: string
): AgentLaunchParams {
  return {
    agent: choice.agent,
    // Stable per run: a retried launch replays instead of opening a second orchestrator.
    operationId: runId,
    ...(choice.accountId ? { claudeAccountId: choice.accountId } : {}),
    target: { kind: 'existing', worktree: `id:${worktreeId}` },
    prompt: { text: prompt, delivery: 'submit' },
    ...(choice.model
      ? {
          sessionOptions: {
            model: choice.model,
            ...(choice.effort ? { effort: choice.effort } : {})
          }
        }
      : {}),
    presentation: 'background'
  }
}

function started(run: TaskStartRun | null, guard: TaskStartRunGuard): Promise<TaskStartResult> {
  return run
    ? Promise.resolve({ ok: true, run: summarizeTaskStartRun(run) })
    : guard.fail('launch-failed', 'launch_failed')
}

/** A name is cosmetic: failing to set it never fails the start. */
function nameOrchestrator(
  ref: TaskStartOrchestratorRef,
  title: string,
  deps: TaskStartLaunchDeps
): void {
  void Promise.resolve()
    .then(() => deps.renameOrchestrator(ref, title))
    .catch((error: unknown) => {
      console.warn('[task-start] naming the orchestrator tab failed', error)
    })
}

/** Launches the orchestrator and records its surface before the prompt is delivered. */
export async function launchTaskStartOrchestrator(
  input: {
    repo: Repo
    worktreeId: string
    choice: TaskStartAgentChoice
    prompt: string
    /** The orchestrator's tab title. */
    title: string
  },
  guard: TaskStartRunGuard,
  deps: TaskStartLaunchDeps
): Promise<TaskStartResult> {
  const { store } = deps.lifecycle
  let published: TaskStartOrchestratorRef | undefined
  const onSurfacePublished = (surface: AgentLaunchResult): void => {
    if (published) {
      return
    }
    published = orchestratorRef(surface, input.repo, input.choice, deps)
    // A stopping run keeps `published` so the start's cancel closes it.
    const run = guard.patch({ launch: 'published', orchestrator: published })
    if (run) {
      watchTaskStartOrchestrator(run, deps.lifecycle, { ptyId: published.ptyId })
    }
    nameOrchestrator(published, input.title, deps)
  }
  let result: AgentLaunchResult
  try {
    result = await deps.launchAgent(
      launchParams(input.choice, guard.runId, input.worktreeId, input.prompt),
      onSurfacePublished
    )
  } catch (error) {
    if (!published) {
      console.warn('[task-start] orchestrator launch failed', error)
      return guard.fail('launch-failed', 'launch_failed')
    }
    if (!guard.alive()) {
      return guard.settle(published)
    }
    // The surface exists: the card says to open the session; stop stays available.
    return started(guard.patch({ note: 'prompt-unconfirmed' }), guard)
  }
  try {
    // Hosts that answer without the callback still published this surface.
    onSurfacePublished(result)
  } catch (error) {
    // The orchestrator is live; a watcher that failed to install is the next reconcile's job.
    console.warn('[task-start] recording the published orchestrator failed', error)
  }
  if (!guard.alive()) {
    return guard.settle(published)
  }
  const outcome = result.prompt?.outcome
  if (outcome && CONFIRMED_PROMPT.has(outcome)) {
    return started(store.getById(guard.runId), guard)
  }
  return started(guard.patch({ note: 'prompt-unconfirmed' }), guard)
}

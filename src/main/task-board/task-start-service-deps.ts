import { getRepoSshConnectionId } from '../../shared/execution-host'
import { WorktreeCreate } from '../../shared/rpc-contract/worktree-create-params'
import { createWorktreeWithStartupAgent } from '../agent-launch/startup-agent-worktree-create'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { resolveRpcWorkspaceCreatorProvenance } from '../runtime/rpc/callers/workspace-creator-context'
import type { RpcContext } from '../runtime/rpc/core'
import { launchAgentOnHost } from '../runtime/rpc/methods/agent-launch/agent-launch'
import { buildManagedWorktreeCreateArgs } from '../runtime/rpc/methods/workspaces/worktree-create-args'
import { readTaskBoardCard, taskBoardRefKeyForRef } from './task-board-host-card'
import { createTaskBoardServiceDeps } from './task-board-host-deps'
import {
  collectTaskStartContext,
  createTaskStartFetchBytes,
  type TaskStartCard
} from './task-start-context'
import {
  createTaskStartContextDeps,
  createTaskStartFetchDeps,
  createTaskStartSshAccess
} from './task-start-context-deps'
import { writeTaskStartImages } from './task-start-context-images'
import { createTaskStartOptionsDeps } from './task-start-options-deps'
import type { TaskStartServiceDeps } from './task-start-service'
import { closeTaskStartOrchestrator } from './task-start-stop-deps'
import { taskStartWorktreeCreateFields } from './task-start-worktree-link'

// In-process like automations: the host launches the orchestrator for whichever client asked.
const TASK_START_AGENT_CALLER = { kind: 'local-cli' } as const

/** This host's runtime behind the start: board reads, worktree create, agent launch and close. */
export function createTaskStartServiceDeps(
  runtime: OrcaRuntimeService,
  context: RpcContext
): TaskStartServiceDeps {
  const board = createTaskBoardServiceDeps(runtime)
  const readers = createTaskStartContextDeps(board)
  const fetchDeps = createTaskStartFetchDeps((repoId) => board.repo(repoId))
  return {
    options: createTaskStartOptionsDeps(runtime),
    lifecycle: board.taskStart,
    cardKey: (ref) => taskBoardRefKeyForRef(ref, board),
    readContext: async (ref) => {
      const read = await readTaskBoardCard(ref, board)
      const card: TaskStartCard = {
        ref,
        provider: read.provider,
        displayId: read.displayId,
        title: read.title,
        url: read.url
      }
      return { card, context: await collectTaskStartContext(card, readers) }
    },
    writeImages: ({ card, repo, runId, images }) => {
      const connectionId = getRepoSshConnectionId(repo)
      const fetchBytes = createTaskStartFetchBytes(card, fetchDeps)
      // Outside the repo and the chat attachment store, whose sweeps would remove the run's folder.
      return connectionId
        ? writeTaskStartImages(
            images,
            { kind: 'ssh', connectionId, hostPlatform: 'posix' },
            runId,
            fetchBytes,
            createTaskStartSshAccess()
          )
        : writeTaskStartImages(
            images,
            { kind: 'local', rootDir: getProfileUserDataPath() },
            runId,
            fetchBytes
          )
    },
    primaryWorktreeId: async (repo) => {
      const { worktrees } = await runtime.listManagedWorktrees(`id:${repo.id}`)
      const main =
        worktrees.find((worktree) => worktree.isMainWorktree) ??
        (repo.kind === 'folder' ? worktrees[0] : undefined)
      if (!main) {
        throw new Error(`No primary checkout for repo ${repo.id}`)
      }
      return main.id
    },
    gitStatus: (selector) => runtime.getRuntimeGitStatus(selector),
    createWorktree: async ({ repo, card, baseBranch }) => {
      const params = WorktreeCreate.parse({
        repo: `id:${repo.id}`,
        ...taskStartWorktreeCreateFields(card),
        ...(baseBranch ? { baseBranch } : {}),
        activate: false
      })
      const created = await createWorktreeWithStartupAgent(
        runtime,
        buildManagedWorktreeCreateArgs(
          params,
          { creatorProvenance: resolveRpcWorkspaceCreatorProvenance(context) },
          context
        )
      )
      return { worktreeId: created.worktree.id }
    },
    launchAgent: (params, onSurfacePublished) =>
      launchAgentOnHost(
        params,
        { runtime, caller: TASK_START_AGENT_CALLER },
        { onSurfacePublished }
      ),
    terminalIdentity: (handle) => ({
      paneKey: runtime.getTerminalPaneKey(handle) ?? undefined,
      ptyId: runtime.getTerminalPtyIdForHandle(handle) ?? undefined
    }),
    closeOrchestrator: (ref) => closeTaskStartOrchestrator(runtime, ref)
  }
}

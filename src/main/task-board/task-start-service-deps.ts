import { getRepoSshConnectionId } from '../../shared/execution-host/execution-host'
import type { TaskStartOrchestratorRef } from '../../shared/task-board/task-start-run'
import { createWorktreeWithStartupAgent } from '../agent-launch/startup-agent-worktree-create'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RpcContext } from '../runtime/rpc/core'
import { launchAgentOnHost } from '../runtime/rpc/methods/agent-launch/agent-launch'
import { readTaskBoardCard, taskBoardRefKeyForRef } from './task-board-host-card'
import { createTaskBoardServiceDeps } from './task-board-host-deps'
import { createTaskStartBranchDeps, taskStartWorktreeCreateArgs } from './task-start-branch-deps'
import {
  collectTaskStartContext,
  createTaskStartFetchBytes,
  type TaskStartCard
} from './task-start-context'
import {
  createJiraAttachmentRegistry,
  createTaskStartContextDeps,
  createTaskStartFetchDeps,
  createTaskStartSshAccess
} from './task-start-context-deps'
import { moveStartedTaskBoardCard } from './task-start-card-move'
import { writeTaskStartImages } from './task-start-context-images'
import { createTaskStartOptionsDeps } from './task-start-options-deps'
import type { TaskStartServiceDeps } from './task-start-service'
import {
  closeTaskStartOrchestrator,
  createTaskStartStopDeps,
  taskStartStopMutation
} from './task-start-stop-deps'

// In-process like automations: the host launches the orchestrator for whichever client asked.
const TASK_START_AGENT_CALLER = { kind: 'local-cli' } as const

/** This host's runtime behind the start: board reads, worktree create, agent launch and close. */
export function createTaskStartServiceDeps(
  runtime: OrcaRuntimeService,
  context: RpcContext
): TaskStartServiceDeps {
  const board = createTaskBoardServiceDeps(runtime)
  const jiraAttachments = createJiraAttachmentRegistry()
  const readers = createTaskStartContextDeps(board, jiraAttachments)
  const fetchDeps = createTaskStartFetchDeps((repoId) => board.repo(repoId), jiraAttachments)
  return {
    options: createTaskStartOptionsDeps(runtime),
    orchestration: createTaskStartStopDeps(runtime).orchestration,
    stopMutation: taskStartStopMutation,
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
    moveCard: (ref, columnId, runAlive) => moveStartedTaskBoardCard(ref, columnId, runAlive, board),
    cardMoved: (cardKey) =>
      runtime.notifyTaskBoardRunsChanged({ type: 'taskBoardRunsChanged', cardKeys: [cardKey] }),
    ...createTaskStartBranchDeps(runtime, context),
    createWorktree: async ({ repo, card, baseBranch }) => {
      const created = await createWorktreeWithStartupAgent(
        runtime,
        taskStartWorktreeCreateArgs(context, repo, card, baseBranch)
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
    closeOrchestrator: (ref) => closeTaskStartOrchestrator(runtime, ref),
    renameOrchestrator: (ref, title) => renameTaskStartOrchestrator(runtime, ref, title)
  }
}

/** Names the orchestrator the way the user renames its tab: the terminal, or the chat's own name. */
async function renameTaskStartOrchestrator(
  runtime: OrcaRuntimeService,
  ref: TaskStartOrchestratorRef,
  title: string
): Promise<void> {
  if (ref.surface === 'terminal') {
    if (ref.handle) {
      await runtime.renameTerminal(ref.handle, title)
    }
    return
  }
  const host = getStructuredAgentSessionHost()
  if (host && ref.sessionId) {
    await host.setUserConversationName(ref.sessionId, title, 'rename')
  }
}

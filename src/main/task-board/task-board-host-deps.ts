import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId,
  getWorktreeExecutionHostId
} from '../../shared/execution-host/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { GitBranchCompareResult } from '../../shared/git/diff/git-diff-compare-types'
import type { PersistedUIState } from '../../shared/orca-profiles/persisted-ui-state-types'
import type { Repo } from '../../shared/repository/repo-types'
import type { RuntimeWorktreeListResult } from '../../shared/worktree/catalog/runtime-worktree-contracts'
import { resolveSourceControlBaseRef } from '../../shared/source-control/decisions/source-control-base-ref-resolution'
import { normalizeTaskBoardSeenComments } from '../../shared/task-board/task-board-seen-comments'
import type { TaskBoardSettings } from '../../shared/task-board/task-board-settings'
import { normalizeVisibleTaskProviders } from '../../shared/work-items/task-providers'
import { normalizeWorkspaceStatuses } from '../../shared/workspace/status/workspace-statuses'
import { addIssueComment as addGitHubIssueComment } from '../github/issues/issue-comment'
import { listLabels as listGitHubLabels } from '../github/issues/issue-field-options'
import { updateIssue as updateGitHubIssue } from '../github/issues/issue-update'
import { getWorkItemDetails as getGitHubWorkItemDetails } from '../github/work-items/work-item-details'
import { addIssueComment as addGitLabIssueComment } from '../gitlab/issues/gitlab-issue-queries'
import { updateIssue as updateGitLabIssue } from '../gitlab/issues/issue-update'
import { listLabels as listGitLabLabels } from '../gitlab/projects/project-label-and-member-lookup'
import { getWorkItemDetails as getGitLabWorkItemDetails } from '../gitlab/work-items/work-item-details'
import { getStatus as getJiraStatus } from '../jira/client'
import { getIssueComments as getJiraIssueComments } from '../jira/jira-issue-comments'
import {
  addIssueComment as addJiraIssueComment,
  updateIssue as updateJiraIssue
} from '../jira/jira-issue-mutations'
import { getIssue as getJiraIssue } from '../jira/jira-issue-read'
import { listTransitions as listJiraTransitions } from '../jira/jira-transition-queries'
import { getClients as getLinearClients } from '../linear/accounts/linear-account-client'
import {
  addIssueComment as addLinearIssueComment,
  getIssueComments as getLinearIssueComments
} from '../linear/issues/linear-issue-comments'
import { getIssue as getLinearIssue } from '../linear/issues/linear-issue-lookups'
import { updateIssue as updateLinearIssue } from '../linear/issues/linear-issue-mutations'
import {
  getTeamStatesOrThrow as getLinearTeamStates,
  getViewerForWorkspaceOrThrow
} from '../linear/teams/linear-team-queries'
import { runPreflightCheck } from '../preflight/agent-detection'
import { readHostedReviewForBranch } from '../source-control/hosted-review'
import { getStoredRepoExecutionHostId } from '../workspaces/execution-host/repo-execution-host'
import type { LocalProjectGhExecOptions } from '../workspaces/execution-host/project-runtime-git-options'
import {
  createTaskStartLifecycleDeps,
  type TaskStartLifecycleRuntime
} from './task-start-lifecycle-deps'
import { createTaskBoardEnrichCaches } from './task-board-enrich'
import { findTaskBoardHostRepo, isTaskBoardHostExecuted } from './task-board-host-repos'
import { createTaskBoardMoveHolds } from './task-board-move-holds'
import { createTaskBoardHostSources } from './task-board-host-sources'
import type { TaskBoardMoveWriteDeps } from './task-board-host-move'
import type { TaskBoardServiceDeps } from './task-board-host-service'
import {
  taskBoardWorkspaceCandidates,
  type TaskBoardWorkspaceCandidate
} from './task-board-workspace-match'

// Enough for every workspace a user keeps; the listing is newest first.
const WORKSPACE_LIST_LIMIT = 1000

/** The runtime surface the board reads; OrcaRuntimeService satisfies it. */
export type TaskBoardRuntime = TaskStartLifecycleRuntime & {
  listRepos(): Repo[]
  getClientSettings(): { taskBoard: TaskBoardSettings; visibleTaskProviders: unknown }
  getUIState(): PersistedUIState
  updateUIState(updates: Partial<PersistedUIState>): unknown
  getLocalGitExecutionOptionArgs(repo: Repo): [] | [LocalProjectGhExecOptions]
  listManagedWorktrees(repoSelector?: string, limit?: number): Promise<RuntimeWorktreeListResult>
  listFolderWorkspaces(): FolderWorkspace[]
  getRuntimeGitBranchCompare(
    worktreeSelector: string,
    baseRef: string,
    admissionTier?: 'background'
  ): Promise<GitBranchCompareResult>
  getRepoBaseRefDefault(repoSelector: string): Promise<{ defaultBaseRef: string | null }>
}

// One per host process: listings from every client share the raw progress/comments.
const caches = createTaskBoardEnrichCaches()
const moveHolds = createTaskBoardMoveHolds()

function defaultLinearWorkspaceId(): string {
  const workspaceId = getLinearClients(null)[0]?.workspace.id
  if (!workspaceId) {
    throw new Error('Not connected to Linear')
  }
  return workspaceId
}

type HostWorkspaces = {
  candidates: TaskBoardWorkspaceCandidate[]
  worktrees: Map<string, RuntimeWorktreeListResult['worktrees'][number]>
}

async function readHostWorkspaces(runtime: TaskBoardRuntime): Promise<HostWorkspaces> {
  const repos = runtime.listRepos()
  const { worktrees } = await runtime.listManagedWorktrees(undefined, WORKSPACE_LIST_LIMIT)
  // Workspaces another Orca runs cannot be read with this host's git.
  const hosted = worktrees.filter((worktree) =>
    isTaskBoardHostExecuted(
      getWorktreeExecutionHostId(
        worktree,
        repos.find((repo) => repo.id === worktree.repoId)
      )
    )
  )
  const folders = runtime
    .listFolderWorkspaces()
    .filter((folder) => isTaskBoardHostExecuted(getRepoExecutionHostId(folder)))
  return {
    candidates: taskBoardWorkspaceCandidates(hosted, folders),
    worktrees: new Map(hosted.map((worktree) => [worktree.id, worktree]))
  }
}

/** Wires the board service to this host's runtime and provider clients. */
export function createTaskBoardServiceDeps(
  runtime: TaskBoardRuntime
): TaskBoardServiceDeps & TaskBoardMoveWriteDeps {
  const repo = (repoId: string) => findTaskBoardHostRepo(runtime.listRepos(), repoId)
  const getLocalGitArgs = (target: Repo) => runtime.getLocalGitExecutionOptionArgs(target)
  // Filled by workspaces(); progress reads need the worktree's base ref and linked review numbers.
  let hostWorkspaces: HostWorkspaces | null = null
  const workspaceRepo = (workspace: TaskBoardWorkspaceCandidate) =>
    workspace.repoId ? repo(workspace.repoId) : null

  return {
    host: {
      repos: () => runtime.listRepos(),
      settings: () => {
        const settings = runtime.getClientSettings()
        return {
          taskBoard: settings.taskBoard,
          visibleTaskProviders: normalizeVisibleTaskProviders(settings.visibleTaskProviders)
        }
      },
      statuses: () => normalizeWorkspaceStatuses(runtime.getUIState().workspaceStatuses),
      preflight: () => runPreflightCheck(),
      // This runtime is local or an orcad; SSH hosts never serve the board themselves.
      isSshHost: false,
      sources: createTaskBoardHostSources({ getLocalGitArgs })
    },
    taskStart: createTaskStartLifecycleDeps(runtime),
    caches,
    moveHolds,
    repo,
    getLocalGitArgs,
    jiraSites: () => getJiraStatus().sites ?? [],
    jiraSiteCount: () => getJiraStatus().sites?.length ?? 0,
    jiraComments: (key, siteId) => getJiraIssueComments(key, siteId, true),
    jiraIssue: (key, siteId) => getJiraIssue(key, siteId, true),
    linearComments: (issueId, workspaceId) => getLinearIssueComments(issueId, workspaceId, true),
    linearViewerId: async (workspaceId) =>
      (await getViewerForWorkspaceOrThrow(workspaceId ?? defaultLinearWorkspaceId())).id,
    linearIssue: (id, workspaceId) => getLinearIssue(id, workspaceId),
    gitlabWorkItemDetails: getGitLabWorkItemDetails,
    githubWorkItemDetails: getGitHubWorkItemDetails,
    workspaces: async () => {
      hostWorkspaces = await readHostWorkspaces(runtime)
      return hostWorkspaces.candidates
    },
    commitsAhead: async (workspace) => {
      const target = workspaceRepo(workspace)
      const worktree = hostWorkspaces?.worktrees.get(workspace.worktreeId)
      if (!target || !worktree) {
        return null
      }
      const baseRef =
        resolveSourceControlBaseRef({
          worktreeBaseRef: worktree.baseRef,
          repoBaseRef: target.worktreeBaseRef
        }) ?? (await runtime.getRepoBaseRefDefault(`id:${target.id}`)).defaultBaseRef
      if (!baseRef) {
        return null
      }
      const { summary } = await runtime.getRuntimeGitBranchCompare(
        `id:${workspace.worktreeId}`,
        baseRef,
        'background'
      )
      return summary.status === 'ready' ? (summary.commitsAhead ?? null) : null
    },
    hostedReview: async ({ workspace, force, userRefresh }) => {
      const target = workspaceRepo(workspace)
      if (!target) {
        return null
      }
      const worktree = hostWorkspaces?.worktrees.get(workspace.worktreeId)
      const read = await readHostedReviewForBranch({
        repoPath: target.path,
        executionHostId: getStoredRepoExecutionHostId(target),
        branch: workspace.branch,
        linkedGitHubPR: worktree?.linkedPR ?? null,
        linkedGitLabMR: worktree?.linkedGitLabMR ?? null,
        force,
        userRefresh,
        // Board reads are background work, as hostedReview.forBranch defaults to.
        localGitExecOptions: { ...getLocalGitArgs(target)[0], admissionTier: 'background' }
      })
      return read.review
    },
    addJiraComment: (key, body, siteId) => addJiraIssueComment(key, body, siteId),
    addLinearComment: (issueId, body, workspaceId) =>
      addLinearIssueComment(issueId, body, workspaceId),
    addGitLabComment: addGitLabIssueComment,
    addGitHubComment: addGitHubIssueComment,
    jiraTransitions: (key, siteId) => listJiraTransitions(key, siteId, true),
    updateJiraIssue: (key, updates, siteId) => updateJiraIssue(key, updates, siteId),
    linearTeamStates: (teamId, workspaceId) => getLinearTeamStates(teamId, workspaceId),
    updateLinearIssue: (id, updates, workspaceId) => updateLinearIssue(id, updates, workspaceId),
    repoLabels: (ref, target) => {
      const connectionId = getRepoRoutingConnectionId(target)
      const localGit = getLocalGitArgs(target)[0] ?? {}
      return ref.provider === 'gitlab'
        ? listGitLabLabels(
            target.path,
            target.issueSourcePreference,
            connectionId,
            localGit,
            ref.projectRef
          )
        : listGitHubLabels(
            target.path,
            target.issueSourcePreference,
            connectionId,
            localGit,
            ref.issueRepo
          )
    },
    updateGitLabIssue,
    updateGitHubIssue,
    readSeen: () => normalizeTaskBoardSeenComments(runtime.getUIState().taskBoardSeenComments),
    writeSeen: (next) => runtime.updateUIState({ taskBoardSeenComments: next })
  }
}

import { databaseTerminalCaller } from './database-terminal-caller'
import { databaseControllerIdentity } from '../../database/catalog/database-controller-identity'
import { requireDatabasePersistence } from './runtime-database-persistence'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { DatabaseProjectKey } from '../../../shared/database/database-contracts'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import type { RpcContext } from '../rpc/core'
import { rpcCallerOperationKey } from '../rpc/rpc-caller-identity'
import type { DatabaseActor } from '../../database/execution/database-query-actor'
import { sameDatabaseProject } from '../../database/catalog/database-project-scope'

export type DatabaseScope = {
  project?: string
  worktree?: string
  executionHostId?: ExecutionHostId
}
export type DatabaseRuntimeHost = Partial<
  Pick<OrcaRuntimeService, 'resolveOrchestrationWorkerServer' | 'callOrchestrationWorkerServer'>
> &
  Pick<OrcaRuntimeService, 'requireStore' | 'getRuntimeId' | 'listRepos' | 'showManagedWorktree'>

export async function resolveDatabaseProject(
  runtime: DatabaseRuntimeHost,
  scope: DatabaseScope
): Promise<DatabaseProjectKey> {
  const store = runtime.requireStore()
  if (scope.project && !scope.worktree) {
    const folder = store.getFolderWorkspace?.(scope.project.replace(/^folder:/, ''))
    if (folder) {
      return {
        kind: 'folder',
        projectId: folder.id,
        executionHostId: folder.executionHostId ?? getRepoExecutionHostId(folder)
      }
    }
    const repos = runtime
      .listRepos()
      .filter(
        (repo) =>
          repo.id === scope.project ||
          store
            .getProjects?.()
            .some(
              (project) => project.id === scope.project && project.sourceRepoIds.includes(repo.id)
            )
      )
    if (repos.length !== 1) {
      throw new Error('Database project is missing or ambiguous; select an explicit workspace')
    }
    const repo = repos[0]
    const project = store.getProjects?.().find((item) => item.sourceRepoIds.includes(repo.id))
    return {
      kind: repo.kind === 'folder' ? 'folder' : 'repository',
      projectId: project?.id ?? repo.id,
      executionHostId: getRepoExecutionHostId(repo)
    }
  }
  if (!scope.worktree || scope.project) {
    throw new Error('Select one database project or workspace')
  }
  const workspace = await runtime.showManagedWorktree(scope.worktree, undefined, {
    matchFolders: true
  })
  const parsed = parseWorkspaceKey(workspace.id)
  if (parsed?.type === 'folder') {
    const folder = store.getFolderWorkspace?.(parsed.folderWorkspaceId)
    if (!folder) {
      throw new Error('Database folder workspace was not found')
    }
    return {
      kind: 'folder',
      projectId: folder.id,
      executionHostId: workspace.hostId ?? folder.executionHostId ?? getRepoExecutionHostId(folder)
    }
  }
  const repo = runtime.listRepos().find((item) => item.id === workspace.repoId)
  if (!repo) {
    throw new Error('Database workspace project was not found')
  }
  const project = store.getProjects?.().find((item) => item.sourceRepoIds.includes(repo.id))
  return {
    kind: repo.kind === 'folder' ? 'folder' : 'repository',
    projectId: workspace.projectId ?? project?.id ?? repo.id,
    executionHostId: workspace.hostId ?? getRepoExecutionHostId(repo)
  }
}

export async function databaseActor(
  context: RpcContext,
  scope: DatabaseScope
): Promise<DatabaseActor> {
  if (!context.caller) {
    throw new Error('Database caller identity is unavailable')
  }
  const project = await resolveDatabaseProject(context.runtime, scope)
  const session = context.orchestrationCaller
  const terminal = databaseTerminalCaller(context)
  const workspaceId =
    session && session.kind !== 'peer' ? session.workspaceId : terminal?.workspaceId
  if (workspaceId) {
    const bound = await resolveDatabaseProject(context.runtime, {
      worktree: `id:${workspaceId}`
    })
    if (!sameDatabaseProject(project, bound)) {
      throw new Error('Database project is outside the caller session')
    }
  }
  return {
    controllerRuntimeId: await databaseControllerIdentity(
      requireDatabasePersistence(context.runtime.requireStore())
    ),
    project,
    sessionId: session
      ? session.kind === 'peer'
        ? session.address
        : session.sessionId
      : (terminal?.sessionId ?? rpcCallerOperationKey(context.caller)),
    owner: context.caller.kind !== 'paired-device' && !session && !terminal,
    ...(terminal ? { terminalHandle: terminal.terminalHandle } : {}),
    ...(session && session.kind !== 'peer' && session.terminalHandle
      ? { terminalHandle: session.terminalHandle }
      : {})
  }
}

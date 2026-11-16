import { getRepoSshConnectionId } from '../../shared/execution-host/execution-host'
import type { Repo } from '../../shared/repository/repo-types'
import type { TaskStartRun } from '../../shared/task-board/task-start-run'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import { removeTaskStartImages } from './task-start-context-images'

async function removeRunImages(run: TaskStartRun, repo: Repo | undefined): Promise<void> {
  // The run's images sit on the host its repo runs on, as `writeImages` placed them.
  const connectionId = repo ? getRepoSshConnectionId(repo) : null
  if (!connectionId) {
    await removeTaskStartImages({ kind: 'local', rootDir: getProfileUserDataPath() }, run.id)
    return
  }
  const connection = getSshConnectionManager()?.getConnection(connectionId)
  if (!connection) {
    return
  }
  await removeTaskStartImages({ kind: 'ssh', connectionId, hostPlatform: 'posix' }, run.id, {
    exec: (_id, command) => execCommand(connection, command)
  })
}

/** Best-effort removal of evicted runs' image folders; a failure only leaves files behind. */
export function cleanUpEvictedTaskStartRuns(repos: () => Repo[]): (runs: TaskStartRun[]) => void {
  return (runs) => {
    const byId = new Map(repos().map((repo) => [repo.id, repo]))
    for (const run of runs) {
      void removeRunImages(run, byId.get(run.repoId)).catch((error: unknown) => {
        console.warn('[task-start] removing an evicted run images failed', error)
      })
    }
  }
}

import type { Repo } from '../../../../../shared/repository/repo-types'
import type { RepoWorkspaceCleanupPolicy } from '../../../../../shared/workspace-cleanup/workspace-cleanup-policy'
import {
  RepositoryTaskStartSection,
  type RepositoryTaskStartUpdate
} from './RepositoryTaskStartSection'
import { RepositoryWorkspaceCleanupSection } from './workspace-cleanup/RepositoryWorkspaceCleanupSection'

type UpdateRepo = (
  repoId: string,
  updates:
    | { workspaceCleanupPolicy: RepoWorkspaceCleanupPolicy | null }
    | Partial<RepositoryTaskStartUpdate>
) => void | Promise<boolean>

/** How workspaces in this project are cleaned up, then how tasks start in them; keyed by the pane per repo. */
export function RepositoryWorkspaceLifecycleSections({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: UpdateRepo
  forceVisible: boolean
}): React.JSX.Element {
  return (
    <>
      <RepositoryWorkspaceCleanupSection
        repo={repo}
        updateRepo={updateRepo}
        forceVisible={forceVisible}
      />
      <RepositoryTaskStartSection repo={repo} updateRepo={updateRepo} forceVisible={forceVisible} />
    </>
  )
}

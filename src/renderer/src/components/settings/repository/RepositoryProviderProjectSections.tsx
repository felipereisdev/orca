import type { JiraProjectReference } from '../../../../../shared/jira/jira-project-reference'
import type { LinearProjectReference } from '../../../../../shared/linear/linear-project-reference'
import type { Repo } from '../../../../../shared/repo-types'
import { RepositoryJiraProjectSection } from './RepositoryJiraProjectSection'
import { RepositoryLinearProjectSection } from './RepositoryLinearProjectSection'

/** The repo's default Jira and Linear projects; keyed by the pane so a repo switch resets both. */
export function RepositoryProviderProjectSections({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: (
    id: string,
    updates:
      | { defaultJiraProject: JiraProjectReference | null }
      | { defaultLinearProject: LinearProjectReference | null }
  ) => unknown
  forceVisible?: boolean
}): React.JSX.Element {
  return (
    <>
      <RepositoryJiraProjectSection
        repo={repo}
        updateRepo={updateRepo}
        forceVisible={forceVisible}
      />
      <RepositoryLinearProjectSection
        repo={repo}
        updateRepo={updateRepo}
        forceVisible={forceVisible}
      />
    </>
  )
}

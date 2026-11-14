import type { ConnectionPresentationModel } from '../screen-state/use-mobile-tasks-connection-presentation'
import { translate } from '../../i18n/mobile-i18n'
import { ScrollView } from 'react-native'
import { SlidersHorizontal, SquareKanban } from 'lucide-react-native'
import { styles } from '../mobile-tasks-legacy-styles'
import { FilterChip } from '../../components/nav-bar/FilterChip'
import { renderMobileTasksGitHubViewControls } from './mobile-tasks-github-view-controls'
import { renderMobileTasksLinearViewControls } from '../providers/linear/mobile-tasks-linear-view-controls'
import { renderMobileTasksJiraViewControls } from '../providers/jira/mobile-tasks-jira-view-controls'
import { mobileTasksFilterCount } from './mobile-tasks-filter-sheet'
import { saveTasksSurface } from '../../storage/preferences'
import { mobileTaskBoardHref } from '../mobile-task-navigation'

/** My board, the scope dropdowns, then the one Filter chip that opens Filter & display. */
export function renderMobileTasksProviderControls(model: ConnectionPresentationModel) {
  const {
    effectiveRepoIds,
    githubMode,
    gitlabFilterLabel,
    gitlabView,
    hostId,
    hostedRepos,
    jiraConnection,
    linearConnected,
    provider,
    repoPickerLabel,
    router,
    setShowFilterSheet,
    setShowGitLabFilterPicker,
    setShowGitLabViewPicker,
    setShowRepoPicker,
    taskUiReady
  } = model
  // My board reads the host's own board, so it stays reachable while this provider is disconnected.
  const scoped = !(
    (provider === 'linear' && !linearConnected) ||
    (provider === 'jira' && !jiraConnection.connected)
  )
  const filterCount = mobileTasksFilterCount(model)
  const gitlabViewLabel =
    gitlabView === 'project'
      ? translate('tasks.providerControls.projectMergeRequests', 'Project MRs')
      : translate('tasks.providerControls.myTodos', 'My Todos')
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.toolbar}
    >
      <FilterChip
        label={translate('tasks.providerControls.myBoard', 'My board')}
        icon={SquareKanban}
        onPress={() => {
          void saveTasksSurface('board').then(() => router.replace(mobileTaskBoardHref(hostId)))
        }}
      />

      {scoped ? (
        <>
          {provider === 'gitlab' || (provider === 'github' && githubMode !== 'project') ? (
            <FilterChip
              label={repoPickerLabel}
              menu
              active={effectiveRepoIds.size > 0 && effectiveRepoIds.size < hostedRepos.length}
              disabled={!taskUiReady}
              accessibilityLabel={translate(
                'tasks.providerControls.reposLabel',
                'Repositories: {{repos}}',
                {
                  repos: repoPickerLabel
                }
              )}
              onPress={() => setShowRepoPicker(true)}
            />
          ) : null}

          {renderMobileTasksGitHubViewControls(model)}

          {provider === 'gitlab' ? (
            <>
              <FilterChip
                label={gitlabViewLabel}
                menu
                disabled={!taskUiReady}
                onPress={() => setShowGitLabViewPicker(true)}
              />
              {gitlabView === 'project' ? (
                <FilterChip
                  label={gitlabFilterLabel}
                  menu
                  disabled={!taskUiReady}
                  onPress={() => setShowGitLabFilterPicker(true)}
                />
              ) : null}
            </>
          ) : null}

          {renderMobileTasksLinearViewControls(model)}

          {renderMobileTasksJiraViewControls(model)}

          <FilterChip
            label={
              filterCount > 0
                ? translate('tasks.providerControls.filterCount', 'Filter · {{count}}', {
                    count: filterCount
                  })
                : translate('tasks.providerControls.filter', 'Filter')
            }
            icon={SlidersHorizontal}
            active={filterCount > 0}
            disabled={!taskUiReady}
            accessibilityLabel={translate(
              'tasks.providerControls.filterLabel',
              'Filter and display'
            )}
            onPress={() => setShowFilterSheet(true)}
          />
        </>
      ) : null}
    </ScrollView>
  )
}

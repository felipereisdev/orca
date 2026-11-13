import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import GitLabItemDialog from '@/components/GitLabItemDialog'
export function TaskPageGitLabDialog({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const {
    gitlabDialogItem,
    setGitlabDialogItem,
    gitlabDialogRepo,
    gitlabDialogSourceContext,
    handleUseGitLabItem,
    pageData,
    closeTaskDetailPage
  } = model
  // Why: a dialog opened from My board closes back to the board.
  const closeDialog = (): void => {
    if (pageData.detailReturnTaskSource) {
      closeTaskDetailPage()
    } else {
      setGitlabDialogItem(null)
    }
  }
  return (
    <GitLabItemDialog
      item={gitlabDialogItem}
      // Use the clicked item’s repo because GitLab results can span multiple repos.
      repoPath={gitlabDialogRepo?.path ?? null}
      repoId={gitlabDialogItem?.repoId ?? null}
      sourceContext={gitlabDialogSourceContext}
      onCreateWorkspace={(item) => {
        closeDialog()
        handleUseGitLabItem(item)
      }}
      onClose={closeDialog}
    />
  )
}

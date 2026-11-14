import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import GitLabItemDialog from '@/components/GitLabItemDialog'
import { useTaskBoardSeenMarker } from '@/components/task-page/orca/task-board-seen-marker'
import { isOrcaTaskSource } from '../../../../../shared/work-items/task-source'
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
  const onCommentsRendered = useTaskBoardSeenMarker(
    isOrcaTaskSource(model.pageData.detailReturnTaskSource)
  )
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
      onCommentsRendered={onCommentsRendered}
    />
  )
}

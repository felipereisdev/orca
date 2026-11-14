import type { OnTaskCommentsRendered } from '@/lib/work-items/task-board/task-board-rendered-comments'
import type { GitLabWorkItem } from '../../../../shared/gitlab-types'
import type { TaskSourceContext } from '../../../../shared/work-items/task-source-context'

export type GitLabItemDialogProps = {
  item: GitLabWorkItem | null
  repoPath: string | null
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  onClose: () => void
  onCreateWorkspace?: (item: GitLabWorkItem) => void
  onCommentsRendered?: OnTaskCommentsRendered
}

export type GitLabDialogRepoSelector = {
  repoPath: string
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  repoOwnerExecutionHostId?: string
}

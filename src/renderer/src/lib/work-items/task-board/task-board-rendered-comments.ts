import { useEffect } from 'react'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

type RenderedComment = { id: string | number; createdAt: string }

/** The comments a provider detail page has on screen for the issue at `url`. */
export type RenderedTaskComments = {
  provider: TaskProvider
  url: string
  comments: readonly RenderedComment[]
}

export type OnTaskCommentsRendered = (rendered: RenderedTaskComments) => void

/**
 * Reports after commit, so only comments that reached the screen are reported. `url`/`comments`
 * must be null while the comments are loading or belong to an issue other than the one shown.
 */
export function useReportRenderedComments(
  onRendered: OnTaskCommentsRendered | undefined,
  provider: TaskProvider,
  url: string | null,
  comments: readonly RenderedComment[] | null
): void {
  useEffect(() => {
    if (onRendered && url && comments) {
      onRendered({ provider, url, comments })
    }
  }, [onRendered, provider, url, comments])
}

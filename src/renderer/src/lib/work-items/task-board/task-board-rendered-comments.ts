import { useEffect } from 'react'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

type RenderedComment = { id: string | number; createdAt: string }

/** The comments a provider detail page has on screen for the issue at `url`, the user's own left out. */
export type RenderedTaskComments = {
  provider: TaskProvider
  url: string
  comments: readonly RenderedComment[]
}

export type OnTaskCommentsRendered = (rendered: RenderedTaskComments) => void

/**
 * Reports after commit, so only comments that reached the screen are reported. `url`/`comments`
 * must be null while the comments are loading or belong to an issue other than the one shown.
 * `isOwn` must be stable; it drops the user's own comments, whose just-posted copies carry the
 * local clock's time: marking up to that time could hide someone else's comment never shown.
 */
export function useReportRenderedComments<C extends RenderedComment>(
  onRendered: OnTaskCommentsRendered | undefined,
  provider: TaskProvider,
  url: string | null,
  comments: readonly C[] | null,
  isOwn: (comment: C) => boolean
): void {
  useEffect(() => {
    if (onRendered && url && comments) {
      onRendered({ provider, url, comments: comments.filter((comment) => !isOwn(comment)) })
    }
  }, [onRendered, provider, url, comments, isOwn])
}

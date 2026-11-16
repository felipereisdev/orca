import { useCallback, useRef } from 'react'
import type {
  OnTaskCommentsRendered,
  RenderedTaskComments
} from '@/lib/work-items/task-board/task-board-rendered-comments'
import { markTaskBoardSeen } from '@/runtime/task-board/runtime-task-board-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import type { ExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { newestOtherTaskBoardComments } from '../../../../../shared/task-board/task-board-seen-comments'
import type {
  TaskBoardCardRef,
  TaskBoardWireCard
} from '../../../../../shared/task-board/task-board-wire-types'
import { clearTaskBoardUnread } from './task-board-session-cache'

// Why: the provider detail pages receive the provider item, not the board card; the board leaves it here.
let openedFromBoard: { accountHostId: ExecutionHostId; card: TaskBoardWireCard } | null = null

export function rememberTaskBoardDetailCard(
  accountHostId: ExecutionHostId,
  card: TaskBoardWireCard
): void {
  openedFromBoard = { accountHostId, card }
}

type SeenComment = { at: string; id: string }

/** In order, so the host records each id at the same instant; rejects at the first refused one. */
async function markAllSeen(
  target: RuntimeClientTarget,
  ref: TaskBoardCardRef,
  comments: readonly SeenComment[]
): Promise<void> {
  for (const comment of comments) {
    await markTaskBoardSeen(target, ref, { at: comment.at, id: comment.id })
  }
}

/**
 * For a provider detail page opened from My board: marks the newest comments it rendered as seen
 * on the board host. Undefined elsewhere, so other detail pages never mark.
 */
export function useTaskBoardSeenMarker(fromBoard: boolean): OnTaskCommentsRendered | undefined {
  const markedRef = useRef<string | null>(null)
  const mark = useCallback((rendered: RenderedTaskComments) => {
    const opened = openedFromBoard
    // The page may show another issue than the card opened from the board (a related issue, a switch).
    if (!opened || opened.card.provider !== rendered.provider || opened.card.url !== rendered.url) {
      return
    }
    // The page has already left out the user's own comments.
    const newest = newestOtherTaskBoardComments(
      rendered.comments.map((comment) => ({
        id: String(comment.id),
        at: comment.createdAt,
        own: false
      }))
    )
    const target = ipcOrRuntimeTargetForHostId(opened.accountHostId)
    const key = [opened.card.refKey, ...newest.map((comment) => comment.id)].join('\0')
    if (newest.length === 0 || !target || key === markedRef.current) {
      return
    }
    markedRef.current = key
    // Best effort: a failed mark leaves the card unread on the board, and the next render tries again.
    void markAllSeen(target, opened.card.ref, newest).then(
      () => clearTaskBoardUnread(opened.accountHostId, opened.card.refKey),
      () => {
        if (markedRef.current === key) {
          markedRef.current = null
        }
      }
    )
  }, [])
  return fromBoard ? mark : undefined
}

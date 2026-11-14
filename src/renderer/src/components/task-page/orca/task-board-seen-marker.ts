import { useCallback, useRef } from 'react'
import type {
  OnTaskCommentsRendered,
  RenderedTaskComments
} from '@/lib/work-items/task-board/task-board-rendered-comments'
import { markTaskBoardSeen } from '@/runtime/task-board/runtime-task-board-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskBoardWireCard } from '../../../../../shared/task-board/task-board-wire-types'
import { clearTaskBoardUnread } from './task-board-session-cache'

// Why: the provider detail pages receive the provider item, not the board card; the board leaves it here.
let openedFromBoard: { accountHostId: ExecutionHostId; card: TaskBoardWireCard } | null = null

export function rememberTaskBoardDetailCard(
  accountHostId: ExecutionHostId,
  card: TaskBoardWireCard
): void {
  openedFromBoard = { accountHostId, card }
}

function newestComment(
  comments: RenderedTaskComments['comments']
): { at: string; id: string } | null {
  let newest: RenderedTaskComments['comments'][number] | null = null
  for (const comment of comments) {
    // An unparseable timestamp never wins over a real one.
    if (!newest || (Date.parse(comment.createdAt) || 0) >= (Date.parse(newest.createdAt) || 0)) {
      newest = comment
    }
  }
  return newest ? { at: newest.createdAt, id: String(newest.id) } : null
}

/**
 * For a provider detail page opened from My board: marks the newest comment it rendered as seen
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
    const newest = newestComment(rendered.comments)
    const target = ipcOrRuntimeTargetForHostId(opened.accountHostId)
    const key = newest ? `${opened.card.refKey}\0${newest.id}` : null
    if (!newest || !target || key === markedRef.current) {
      return
    }
    markedRef.current = key
    clearTaskBoardUnread(opened.accountHostId, opened.card.refKey)
    // Best effort: a failed mark leaves the comments unread, and the next render tries again.
    void markTaskBoardSeen(target, opened.card.ref, newest).catch(() => {
      if (markedRef.current === key) {
        markedRef.current = null
      }
    })
  }, [])
  return fromBoard ? mark : undefined
}

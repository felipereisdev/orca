import { useEffect, useRef, useState } from 'react'
import type {
  TaskBoardComment,
  TaskBoardDetailResult,
  TaskBoardWireCard
} from '../../../../src/shared/task-board/task-board-wire-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import {
  addTaskBoardComment,
  markTaskBoardSeen,
  readTaskBoardDetail
} from './task-board-operations'

export type TaskBoardDetailRead =
  | { status: 'loading' }
  | { status: 'ready'; detail: TaskBoardDetailResult }
  | { status: 'error'; message: string }

export type TaskBoardCommentSend =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'failed'; error: string }
  // The request failed on the way: the comment may be on the issue already.
  | { status: 'unconfirmed'; error: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Own comments never count as unread, and may carry the phone's clock instead of the provider's.
function newestOtherComment(comments: readonly TaskBoardComment[]): TaskBoardComment | null {
  let newest: TaskBoardComment | null = null
  for (const comment of comments) {
    // An unparseable timestamp never wins over a real one; a tie goes to the later-listed comment.
    if (
      !comment.own &&
      (!newest || (Date.parse(comment.at) || 0) >= (Date.parse(newest.at) || 0))
    ) {
      newest = comment
    }
  }
  return newest
}

type Params = {
  client: RpcClient | null
  connected: boolean
  /** One card for the hook's whole life: the drawer mounts it again for another card. */
  card: TaskBoardWireCard
  /** The drawer is up, so a detail the hook holds is one the person is looking at. */
  open: boolean
  onSeen: () => void
}

/** The open card's fresh detail, its comment composer, and the read marker for what it showed. */
export function useTaskBoardDetail({ client, connected, card, open, onSeen }: Params) {
  const [read, setRead] = useState<TaskBoardDetailRead>({ status: 'loading' })
  const [readCount, setReadCount] = useState(0)
  const [draft, setDraft] = useState('')
  const [send, setSend] = useState<TaskBoardCommentSend>({ status: 'idle' })
  const marked = useRef<string | null>(null)
  const sending = useRef(false)
  // The board's card changes identity on every list; the issue it names does not.
  const [ref] = useState(() => card.ref)

  useEffect(() => {
    if (!client || !connected) {
      return
    }
    let current = true
    // A later read keeps the comments on screen until it lands.
    setRead((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }))
    readTaskBoardDetail(client, ref).then(
      (detail) => current && setRead({ status: 'ready', detail }),
      (error: unknown) =>
        current &&
        setRead((previous) =>
          previous.status === 'ready' ? previous : { status: 'error', message: errorMessage(error) }
        )
    )
    return () => {
      current = false
    }
  }, [client, connected, ref, readCount])

  // Runs after the commit that drew the comments, so only a rendered comment is ever marked.
  useEffect(() => {
    if (!open || !client || read.status !== 'ready') {
      return
    }
    const newest = newestOtherComment(read.detail.comments)
    if (!newest || marked.current === newest.id) {
      return
    }
    marked.current = newest.id
    // Best effort: a refused or lost mark leaves the card unread, and the next detail tries again.
    markTaskBoardSeen(client, ref, { at: newest.at, id: newest.id }).then(
      (accepted) => {
        if (accepted) {
          onSeen()
        } else if (marked.current === newest.id) {
          marked.current = null
        }
      },
      () => {
        if (marked.current === newest.id) {
          marked.current = null
        }
      }
    )
  }, [open, client, read, ref, onSeen])

  const sendComment = async (): Promise<void> => {
    const body = draft.trim()
    if (!client || !connected || !body || sending.current) {
      return
    }
    sending.current = true
    setSend({ status: 'sending' })
    try {
      const result = await addTaskBoardComment(client, ref, body)
      if (result.status === 'added') {
        setDraft('')
        setSend({ status: 'idle' })
        setReadCount((count) => count + 1)
      } else {
        // The draft stays for the person to send again; the composer never retries on its own.
        setSend({ status: 'failed', error: result.error })
      }
    } catch (error) {
      setSend({ status: 'unconfirmed', error: errorMessage(error) })
      setReadCount((count) => count + 1)
    } finally {
      sending.current = false
    }
  }

  return {
    read,
    reload: () => setReadCount((count) => count + 1),
    draft,
    setDraft,
    send,
    sendComment
  }
}

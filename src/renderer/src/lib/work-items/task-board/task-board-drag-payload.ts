import { measureUtf8ByteLength } from '../../../../../shared/utf8-byte-limits'

export const TASK_BOARD_DRAG_CARD_MIME = 'application/x-orca-task-board-card'
export const TASK_BOARD_DRAG_CARD_MAX_BYTES = 1024

export type TaskBoardCardDragReadResult =
  | { status: 'card'; refKey: string }
  | { status: 'hidden' }
  | { status: 'missing' }
  | { status: 'rejected'; reason: 'too-large' | 'malformed' }

export function writeTaskBoardCardDragData(
  dataTransfer: Pick<DataTransfer, 'setData'> & { effectAllowed: string },
  refKey: string
): boolean {
  if (!refKey) {
    return false
  }
  const payload = JSON.stringify({ refKey })
  if (isTooLarge(payload)) {
    return false
  }
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(TASK_BOARD_DRAG_CARD_MIME, payload)
  dataTransfer.setData('text/plain', refKey)
  return true
}

export function readTaskBoardCardDragData(
  dataTransfer: Pick<DataTransfer, 'getData' | 'types'>
): TaskBoardCardDragReadResult {
  const hasTypedPayload = Array.from(dataTransfer.types).includes(TASK_BOARD_DRAG_CARD_MIME)
  const payload = dataTransfer.getData(TASK_BOARD_DRAG_CARD_MIME)
  if (!payload) {
    // Electron hides getData during dragover; a present MIME with empty data is pending readability, not absent payload.
    return hasTypedPayload ? { status: 'hidden' } : { status: 'missing' }
  }
  if (isTooLarge(payload)) {
    return { status: 'rejected', reason: 'too-large' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { status: 'rejected', reason: 'malformed' }
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('refKey' in parsed) ||
    typeof parsed.refKey !== 'string' ||
    parsed.refKey.length === 0
  ) {
    return { status: 'rejected', reason: 'malformed' }
  }
  return { status: 'card', refKey: parsed.refKey }
}

function isTooLarge(payload: string): boolean {
  return (
    payload.length > TASK_BOARD_DRAG_CARD_MAX_BYTES ||
    measureUtf8ByteLength(payload, { stopAfterBytes: TASK_BOARD_DRAG_CARD_MAX_BYTES }).exceededLimit
  )
}

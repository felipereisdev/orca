export type TaskBoardSeenMarker = { at: string; ids: string[] }
export type TaskBoardSeenComments = Record<string, TaskBoardSeenMarker>

export const TASK_BOARD_SEEN_MAX_ENTRIES = 2000
const TASK_BOARD_SEEN_MAX_IDS = 50
const NO_MARKER_WINDOW_MS = 24 * 60 * 60 * 1000

function toMs(at: string): number {
  return Date.parse(at)
}

function normalizeMarker(value: unknown): TaskBoardSeenMarker | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const at = 'at' in value ? value.at : undefined
  const ids = 'ids' in value ? value.ids : undefined
  if (typeof at !== 'string' || Number.isNaN(toMs(at)) || !Array.isArray(ids)) {
    return null
  }
  const cleanIds = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return { at, ids: cleanIds.slice(-TASK_BOARD_SEEN_MAX_IDS) }
}

function capEntries(state: TaskBoardSeenComments): TaskBoardSeenComments {
  const keys = Object.keys(state)
  if (keys.length <= TASK_BOARD_SEEN_MAX_ENTRIES) {
    return state
  }
  // Oldest markers belong to cards least likely to be viewed again.
  const keep = keys
    .sort((a, b) => toMs(state[b].at) - toMs(state[a].at))
    .slice(0, TASK_BOARD_SEEN_MAX_ENTRIES)
  const next: TaskBoardSeenComments = {}
  for (const key of keep) {
    next[key] = state[key]
  }
  return next
}

export function normalizeTaskBoardSeenComments(value: unknown): TaskBoardSeenComments {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const next: TaskBoardSeenComments = {}
  for (const [refKey, raw] of Object.entries(value)) {
    const marker = normalizeMarker(raw)
    if (refKey && marker) {
      next[refKey] = marker
    }
  }
  return capEntries(next)
}

export function markTaskBoardCommentsSeen(
  state: TaskBoardSeenComments,
  refKey: string,
  newest: { at: string; id: string }
): TaskBoardSeenComments {
  const current = state[refKey]
  const newestMs = toMs(newest.at)
  if (Number.isNaN(newestMs)) {
    return state
  }
  if (current) {
    const currentMs = toMs(current.at)
    if (newestMs < currentMs) {
      return state
    }
    if (newestMs === currentMs) {
      if (current.ids.includes(newest.id)) {
        return state
      }
      const ids = [...current.ids, newest.id].slice(-TASK_BOARD_SEEN_MAX_IDS)
      return { ...state, [refKey]: { at: current.at, ids } }
    }
  }
  return capEntries({ ...state, [refKey]: { at: newest.at, ids: [newest.id] } })
}

export type TaskBoardCommentForCount = { id: string; at: string; own: boolean }

/**
 * What a client marks after rendering comments: others' comments at the newest instant. The host
 * keeps every id at the marker's instant, so a tie marks each one; marking one would leave the rest
 * unread. Own comments never count as unread and may carry the client's clock.
 */
export function newestOtherTaskBoardComments<C extends TaskBoardCommentForCount>(
  comments: readonly C[]
): C[] {
  let newestMs = Number.NEGATIVE_INFINITY
  let newest: C[] = []
  for (const comment of comments) {
    const ms = toMs(comment.at)
    // The host cannot place an unparseable timestamp, so it is never sent as a marker.
    if (comment.own || Number.isNaN(ms) || ms < newestMs) {
      continue
    }
    newest = ms > newestMs ? [comment] : [...newest, comment]
    newestMs = ms
  }
  return newest
}

export function countUnreadTaskBoardComments(
  comments: readonly TaskBoardCommentForCount[],
  marker: TaskBoardSeenMarker | undefined,
  now: Date
): number {
  const thresholdMs = marker ? toMs(marker.at) : now.getTime() - NO_MARKER_WINDOW_MS
  let unread = 0
  for (const comment of comments) {
    if (comment.own) {
      continue
    }
    const ms = toMs(comment.at)
    const sameInstantUnseen =
      marker !== undefined && ms === thresholdMs && !marker.ids.includes(comment.id)
    if (ms > thresholdMs || sameInstantUnseen) {
      unread++
    }
  }
  return unread
}

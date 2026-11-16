import { WORK_ITEM_SEARCH_CACHE_MS } from '../github/client/list/work-item-search-batch'

/** After the host moves a card no client dragged, provider list caches still hold its old column. */
export type TaskBoardListFreshness = {
  /** Lists skip provider list caches until those written before now have expired. */
  markMoved(): void
  /** Whether this list skips provider list caches: asked for, or a host move is younger than them. */
  fresh(requested: boolean): boolean
}

export function createTaskBoardListFreshness(
  now: () => number = Date.now,
  // gh's `--cache 120s` and the GraphQL search cache share this age.
  cacheMs: number = WORK_ITEM_SEARCH_CACHE_MS
): TaskBoardListFreshness {
  let freshUntil = 0
  return {
    markMoved: () => {
      freshUntil = now() + cacheMs
    },
    fresh: (requested) => requested || now() < freshUntil
  }
}

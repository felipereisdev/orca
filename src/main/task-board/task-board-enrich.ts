import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import {
  countUnreadTaskBoardComments,
  type TaskBoardSeenComments
} from '../../shared/task-board/task-board-seen-comments'
import type {
  TaskBoardComment,
  TaskBoardCommentSummary,
  TaskBoardProgress,
  TaskBoardWireCard
} from '../../shared/task-board/task-board-wire-types'
import { readTaskBoardComments, type TaskBoardCommentDeps } from './task-board-comments'
import { TASK_BOARD_CACHE_TTL_MS, TaskBoardHostCache } from './task-board-host-cache'
import { readTaskBoardProgress, type TaskBoardProgressDeps } from './task-board-progress'
import {
  findTaskBoardWorkspace,
  type TaskBoardWorkspaceCandidate
} from './task-board-workspace-match'

// Provider readers hold their own request slots; this only bounds how many cards wait on them.
const ENRICH_CONCURRENCY = 6
const CACHE_MAX_ENTRIES = 500
const EXCERPT_MAX_CHARS = 140

export type TaskBoardEnrichCaches = {
  progress: TaskBoardHostCache<TaskBoardProgress>
  comments: TaskBoardHostCache<TaskBoardComment[]>
}

export function createTaskBoardEnrichCaches(now?: () => number): TaskBoardEnrichCaches {
  return {
    progress: new TaskBoardHostCache(TASK_BOARD_CACHE_TTL_MS, CACHE_MAX_ENTRIES, now),
    comments: new TaskBoardHostCache(TASK_BOARD_CACHE_TTL_MS, CACHE_MAX_ENTRIES, now)
  }
}

/** A move or a new comment changes what the providers answer for this card. */
export function invalidateTaskBoardCardCaches(caches: TaskBoardEnrichCaches, refKey: string): void {
  caches.progress.delete(refKey)
  caches.comments.delete(refKey)
}

/** A plain object: enrichment wraps some readers per call by spreading it. */
export type TaskBoardEnrichDeps = TaskBoardCommentDeps &
  TaskBoardProgressDeps & {
    workspaces(): Promise<readonly TaskBoardWorkspaceCandidate[]>
    caches: TaskBoardEnrichCaches
  }

export type TaskBoardEnrichContext = {
  todoColumnId: string | null
  doneColumnId: string
  fresh: boolean
  seen: TaskBoardSeenComments
  now: Date
  deps: TaskBoardEnrichDeps
}

function isEnrichable(card: TaskBoardWireCard, ctx: TaskBoardEnrichContext): boolean {
  return card.columnId !== ctx.todoColumnId && card.columnId !== ctx.doneColumnId
}

async function cachedProgress(
  card: TaskBoardWireCard,
  workspaces: readonly TaskBoardWorkspaceCandidate[] | null,
  ctx: TaskBoardEnrichContext,
  deps: TaskBoardEnrichDeps
): Promise<TaskBoardProgress | null> {
  if (!workspaces) {
    throw new Error('Workspaces could not be listed')
  }
  const workspace = findTaskBoardWorkspace(card, workspaces)
  if (!workspace) {
    return null
  }
  const cached = ctx.fresh ? undefined : deps.caches.progress.get(card.refKey)
  // A relinked workspace or a switched branch makes the cached progress describe something else.
  if (cached && cached.worktreeId === workspace.worktreeId && cached.branch === workspace.branch) {
    return cached
  }
  const progress = await readTaskBoardProgress(workspace, { fresh: ctx.fresh }, deps)
  deps.caches.progress.set(card.refKey, progress)
  return progress
}

async function cachedComments(
  card: TaskBoardWireCard,
  ctx: TaskBoardEnrichContext,
  deps: TaskBoardEnrichDeps
): Promise<TaskBoardComment[]> {
  const cached = ctx.fresh ? undefined : deps.caches.comments.get(card.refKey)
  if (cached) {
    return cached
  }
  const comments = await readTaskBoardComments(card, deps)
  deps.caches.comments.set(card.refKey, comments)
  return comments
}

function summarize(comment: TaskBoardComment): TaskBoardCommentSummary {
  const text = comment.body.replace(/\s+/g, ' ').trim()
  return {
    author: comment.author,
    at: comment.at,
    excerpt: text.length > EXCERPT_MAX_CHARS ? `${text.slice(0, EXCERPT_MAX_CHARS - 1)}…` : text
  }
}

async function enrichCard(
  card: TaskBoardWireCard,
  workspaces: readonly TaskBoardWorkspaceCandidate[] | null,
  ctx: TaskBoardEnrichContext,
  deps: TaskBoardEnrichDeps
): Promise<TaskBoardWireCard> {
  const [progress, comments] = await Promise.allSettled([
    cachedProgress(card, workspaces, ctx, deps),
    cachedComments(card, ctx, deps)
  ])
  // A failed read keeps the card and says so; null/0 would claim "no workspace"/"no comments".
  const enriched: TaskBoardWireCard = {
    ...card,
    enrichment:
      progress.status === 'fulfilled' && comments.status === 'fulfilled' ? 'ok' : 'unavailable'
  }
  if (progress.status === 'fulfilled') {
    enriched.progress = progress.value
  }
  if (comments.status === 'fulfilled') {
    const latest = comments.value.at(-1)
    enriched.latestComment = latest ? summarize(latest) : null
    // Computed from the current marker on every call, so a read elsewhere shows up immediately.
    enriched.unreadComments = countUnreadTaskBoardComments(
      comments.value,
      ctx.seen[card.refKey],
      ctx.now
    )
  }
  return enriched
}

function memoizeViewerId(
  read: TaskBoardCommentDeps['linearViewerId']
): TaskBoardCommentDeps['linearViewerId'] {
  const viewers = new Map<string | null, Promise<string>>()
  return (workspaceId) => {
    let viewer = viewers.get(workspaceId)
    if (!viewer) {
      viewer = read(workspaceId)
      viewers.set(workspaceId, viewer)
    }
    return viewer
  }
}

/** Adds progress and comment summaries to In progress / In review cards; other cards pass through. */
export async function enrichTaskBoardCards(
  cards: TaskBoardWireCard[],
  ctx: TaskBoardEnrichContext
): Promise<TaskBoardWireCard[]> {
  if (!cards.some((card) => isEnrichable(card, ctx))) {
    return cards
  }
  const workspaces = await ctx.deps.workspaces().catch(() => null)
  // One viewer lookup per Linear workspace per listing, not one per card.
  const deps = { ...ctx.deps, linearViewerId: memoizeViewerId(ctx.deps.linearViewerId) }
  return mapWithConcurrency(cards, ENRICH_CONCURRENCY, (card) =>
    isEnrichable(card, ctx) ? enrichCard(card, workspaces, ctx, deps) : Promise.resolve(card)
  )
}

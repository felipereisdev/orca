import { describe, expect, it } from 'vitest'
import {
  TASK_BOARD_SEEN_MAX_ENTRIES,
  countUnreadTaskBoardComments,
  markTaskBoardCommentsSeen,
  newestOtherTaskBoardComments,
  normalizeTaskBoardSeenComments
} from './task-board-seen-comments'

const hoursBefore = (now: Date, h: number): string =>
  new Date(now.getTime() - h * 3_600_000).toISOString()

describe('countUnreadTaskBoardComments', () => {
  it('without a marker counts only other people comments from the last 24h', () => {
    const now = new Date('2026-11-14T12:00:00Z')
    const comments = [
      { id: 'a', at: hoursBefore(now, 23), own: false },
      { id: 'b', at: hoursBefore(now, 25), own: false },
      { id: 'c', at: hoursBefore(now, 1), own: true }
    ]
    expect(countUnreadTaskBoardComments(comments, undefined, now)).toBe(1)
  })

  it('with a marker counts newer comments and same-instant comments not yet seen', () => {
    const marker = { at: '2026-11-10T10:00:00Z', ids: ['a'] }
    const comments = [
      { id: 'a', at: '2026-11-10T10:00:00Z', own: false },
      { id: 'b', at: '2026-11-10T10:00:00Z', own: false },
      { id: 'c', at: '2026-11-10T11:00:00Z', own: false },
      { id: 'd', at: '2026-11-10T09:00:00Z', own: false }
    ]
    expect(countUnreadTaskBoardComments(comments, marker, new Date('2026-11-14T00:00:00Z'))).toBe(2)
  })
})

describe('markTaskBoardCommentsSeen', () => {
  it('keeps the newer marker when an older one is marked afterwards', () => {
    const newer = { at: '2026-11-10T11:00:00Z', id: 'n' }
    const older = { at: '2026-11-10T09:00:00Z', id: 'o' }
    const state = markTaskBoardCommentsSeen(markTaskBoardCommentsSeen({}, 'k', newer), 'k', older)
    expect(state.k).toEqual({ at: newer.at, ids: ['n'] })
  })

  it('adds ids seen at the same instant and replaces on newer', () => {
    let state = markTaskBoardCommentsSeen({}, 'k', { at: '2026-11-10T10:00:00Z', id: 'a' })
    state = markTaskBoardCommentsSeen(state, 'k', { at: '2026-11-10T10:00:00Z', id: 'b' })
    expect(state.k.ids).toEqual(['a', 'b'])
    state = markTaskBoardCommentsSeen(state, 'k', { at: '2026-11-10T10:00:01Z', id: 'c' })
    expect(state.k).toEqual({ at: '2026-11-10T10:00:01Z', ids: ['c'] })
  })

  it('drops the oldest marker beyond the cap', () => {
    let state: Record<string, { at: string; ids: string[] }> = {}
    for (let i = 0; i <= TASK_BOARD_SEEN_MAX_ENTRIES; i++) {
      state = markTaskBoardCommentsSeen(state, `k${i}`, {
        at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
        id: 'x'
      })
    }
    expect(Object.keys(state)).toHaveLength(TASK_BOARD_SEEN_MAX_ENTRIES)
    expect(state.k0).toBeUndefined()
    expect(state.k1).toBeDefined()
  })
})

describe('normalizeTaskBoardSeenComments', () => {
  it('drops malformed entries', () => {
    expect(
      normalizeTaskBoardSeenComments({
        ok: { at: '2026-11-10T10:00:00Z', ids: ['a', 3] },
        badAt: { at: 'nope', ids: [] },
        noIds: { at: '2026-11-10T10:00:00Z' },
        str: 'x'
      })
    ).toEqual({ ok: { at: '2026-11-10T10:00:00Z', ids: ['a'] } })
    expect(normalizeTaskBoardSeenComments([1])).toEqual({})
  })
})

describe('newestOtherTaskBoardComments', () => {
  it('picks every other-person comment at the newest instant, never own or unparseable ones', () => {
    const comments = [
      { id: 'old', at: '2026-11-10T09:00:00Z', own: false },
      { id: 'a', at: '2026-11-10T10:00:00Z', own: false },
      { id: 'mine', at: '2026-11-10T11:00:00Z', own: true },
      { id: 'bad', at: 'not a date', own: false },
      { id: 'b', at: '2026-11-10T10:00:00.000Z', own: false }
    ]
    expect(newestOtherTaskBoardComments(comments).map((comment) => comment.id)).toEqual(['a', 'b'])
  })
})

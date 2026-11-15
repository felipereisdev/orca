import { describe, expect, it } from 'vitest'
import {
  isTaskStartRunExclusive,
  normalizeTaskStartRuns,
  summarizeTaskStartRun,
  taskStartPercent,
  type TaskStartRun
} from './task-start-run'

const validRun: TaskStartRun = {
  id: 'run-1',
  cardKey: 'k',
  repoId: 'repo-1',
  workspaceMode: 'worktree',
  launch: 'published',
  state: 'running',
  phase: 'planning',
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('task start run', () => {
  it('scales development by subtask progress', () => {
    expect(taskStartPercent('development', { current: 3, total: 7 })).toBe(51)
    expect(taskStartPercent('development', { current: 7, total: 7 })).toBe(80)
    expect(taskStartPercent('development', { current: 9, total: 0 })).toBe(30)
    expect(taskStartPercent('development', { current: 12, total: 7 })).toBe(80)
  })

  it('summarizes with percent and worktreeId', () => {
    const summary = summarizeTaskStartRun({ ...validRun, worktreeId: 'wt-1' })
    expect(summary).toMatchObject({ id: 'run-1', worktreeId: 'wt-1', percent: 10 })
    expect(summary).not.toHaveProperty('repoId')
  })

  it('treats running, waiting and stopping as exclusive', () => {
    expect(isTaskStartRunExclusive({ ...validRun, state: 'waiting' })).toBe(true)
    expect(isTaskStartRunExclusive({ ...validRun, state: 'stopping' })).toBe(true)
    expect(isTaskStartRunExclusive({ ...validRun, state: 'stopped' })).toBe(false)
  })

  it('fails a pending launch left over from a previous process', () => {
    const runs = normalizeTaskStartRuns({ k: { ...validRun, launch: 'pending', state: 'running' } })
    expect(runs.k).toMatchObject({ state: 'failed', failure: 'launch-failed' })
  })

  it('evicts the oldest inactive runs first past the cap', () => {
    const input: Record<string, unknown> = {
      active: {
        ...validRun,
        cardKey: 'active',
        state: 'running',
        updatedAt: '2020-01-01T00:00:00.000Z'
      }
    }
    for (let i = 0; i < 500; i++) {
      const key = `done-${i}`
      const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
      input[key] = { ...validRun, cardKey: key, state: 'completed', phase: 'completed', updatedAt }
    }
    const runs = normalizeTaskStartRuns(input)
    expect(Object.keys(runs)).toHaveLength(500)
    expect(runs.active).toBeDefined()
    expect(runs['done-0']).toBeUndefined()
    expect(runs['done-1']).toBeDefined()
  })
})

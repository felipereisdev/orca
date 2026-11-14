import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveTasksSurface } from '../storage/tasks-surface-preference'
import { mobileTasksEntryHref } from './mobile-task-navigation'

const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      stored.set(key, value)
    }
  }
}))

const BOARD_HOST = ['mobile.task-board.v1']

describe('where Tasks opens', () => {
  beforeEach(() => {
    stored.clear()
  })

  it('opens My board only on the host where it was chosen, and only once that host announced it', async () => {
    await saveTasksSurface('host-a', 'board')

    expect(await mobileTasksEntryHref('host-a', BOARD_HOST)).toBe('/h/host-a/board')
    // An older Orca serves no board route; its status not known yet is treated the same.
    expect(await mobileTasksEntryHref('host-a', [])).toBe('/h/host-a/tasks')
    expect(await mobileTasksEntryHref('host-a', null)).toBe('/h/host-a/tasks')
    expect(await mobileTasksEntryHref('host-b', BOARD_HOST)).toBe('/h/host-b/tasks')

    await saveTasksSurface('host-a', 'lists')
    expect(await mobileTasksEntryHref('host-a', BOARD_HOST)).toBe('/h/host-a/tasks')
  })
})

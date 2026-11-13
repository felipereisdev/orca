import { describe, expect, it } from 'vitest'
import { isTaskSourceVisible, resolveVisibleTaskSource } from './task-source'

describe('resolveVisibleTaskSource', () => {
  it('keeps the orca board even when no provider list mentions it', () => {
    expect(resolveVisibleTaskSource('orca', ['jira'])).toBe('orca')
    expect(isTaskSourceVisible('orca', ['jira'])).toBe(true)
  })

  it('falls back to a visible provider for a hidden one', () => {
    expect(resolveVisibleTaskSource('github', ['jira', 'linear'])).toBe('jira')
    expect(isTaskSourceVisible('github', ['jira', 'linear'])).toBe(false)
  })
})

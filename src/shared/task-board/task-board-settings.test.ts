import { describe, expect, it } from 'vitest'
import { normalizeTaskBoardSettings } from './task-board-settings'

const empty = { rules: [], dropTargets: {} }

describe('normalizeTaskBoardSettings', () => {
  it('returns defaults for missing input', () => {
    expect(normalizeTaskBoardSettings(undefined)).toEqual({
      doneStatusId: 'completed',
      providers: { github: empty, gitlab: empty, linear: empty, jira: empty }
    })
  })

  it('repairs malformed input', () => {
    const result = normalizeTaskBoardSettings({
      doneStatusId: '  ',
      providers: {
        jira: {
          rules: [
            { match: ' Em homologação ', statusId: 'in-review' },
            { match: '', statusId: 'todo' },
            { match: 'x' },
            'junk'
          ],
          dropTargets: { 'in-review': ' Em homologação ', bad: 3 }
        },
        nope: {}
      }
    })
    expect(result.doneStatusId).toBe('completed')
    expect(result.providers.jira).toEqual({
      rules: [{ match: 'Em homologação', statusId: 'in-review' }],
      dropTargets: { 'in-review': 'Em homologação' }
    })
    expect(result.providers).not.toHaveProperty('nope')
    expect(result.providers.github).toEqual(empty)
    expect(result.providers.linear).toEqual(empty)
  })

  it('caps rules at 50 per provider', () => {
    const rules = Array.from({ length: 60 }, (_, i) => ({ match: `m${i}`, statusId: 's' }))
    const result = normalizeTaskBoardSettings({ providers: { github: { rules } } })
    expect(result.providers.github.rules).toHaveLength(50)
  })
})

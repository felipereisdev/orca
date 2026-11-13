import { describe, expect, it } from 'vitest'
import { normalizeTaskProviderSettings } from './task-providers'

describe('normalizeTaskProviderSettings', () => {
  it('keeps orca as the default without repairing the visible provider list', () => {
    expect(
      normalizeTaskProviderSettings({ visibleTaskProviders: ['jira'], defaultTaskSource: 'orca' })
    ).toEqual({ visibleTaskProviders: ['jira'], defaultTaskSource: 'orca' })
  })

  it('falls back to a visible provider for unknown sources', () => {
    expect(
      normalizeTaskProviderSettings({ visibleTaskProviders: ['jira'], defaultTaskSource: 'bogus' })
    ).toEqual({ visibleTaskProviders: ['jira'], defaultTaskSource: 'jira' })
  })
})

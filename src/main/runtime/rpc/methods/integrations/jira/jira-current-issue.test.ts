import { expect, it } from 'vitest'
import type { RuntimeReferenceListResult } from '../../../../../../shared/runtime-reference-contracts'
import { currentJiraReference } from './jira-current-issue'

function workspace(references: unknown[]): RuntimeReferenceListResult {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only references are read by currentJiraReference.
  return { references } as RuntimeReferenceListResult
}

it('resolves a Jira URL-only reference without assuming a git worktree', () => {
  expect(
    currentJiraReference(
      workspace([
        { provider: 'jira', type: 'issue', number: 0, url: 'https://jira.example/browse/NDC-1163' }
      ])
    )
  ).toEqual({ key: 'NDC-1163', url: 'https://jira.example/browse/NDC-1163', siteId: undefined })
})

it('refuses a workspace with multiple different Jira issues', () => {
  expect(() =>
    currentJiraReference(
      workspace([
        {
          provider: 'jira',
          type: 'issue',
          number: 0,
          identifier: 'NDC-1163',
          url: 'https://jira.example/browse/NDC-1163'
        },
        {
          provider: 'jira',
          type: 'issue',
          number: 0,
          identifier: 'NDC-1164',
          url: 'https://jira.example/browse/NDC-1164'
        }
      ])
    )
  ).toThrowError(expect.objectContaining({ code: 'jira_current_ambiguous' }))
})

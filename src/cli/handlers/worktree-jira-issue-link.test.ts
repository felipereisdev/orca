import { expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { resolveWorktreeJiraLink } from './worktree-jira-issue-link'

vi.mock('../jira-target', () => ({
  resolveJiraTarget: async () => ({
    key: 'ENG-3',
    siteId: 'site-a',
    site: { siteUrl: 'https://jira.example' }
  })
}))
vi.mock('../reference-input', () => ({
  assertReferenceWritesSupported: async () => {},
  resolveReferenceInputs: async () => [
    {
      provider: 'jira',
      type: 'issue',
      number: 0,
      identifier: 'ENG-3',
      url: 'https://jira.example/browse/ENG-3',
      title: 'Verified issue'
    }
  ]
}))
it('merges verified Jira attachments with existing references using native source context', async () => {
  const call = vi.fn().mockResolvedValue({
    result: {
      worktree: {
        projectId: 'orca-project',
        hostId: 'ssh:host-a',
        repoId: 'repo-a',
        projectHostSetupId: 'setup-a'
      },
      references: [
        { provider: 'github', type: 'issue', number: 5, key: 'reference-key', selected: true }
      ]
    }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this resolver only reads flags and calls the stubbed RPC client.
  const context = {
    flags: new Map([['jira-issue', 'ENG-3']]),
    client: { call }
  } as unknown as HandlerContext
  expect(await resolveWorktreeJiraLink(context, { worktree: 'id:workspace' })).toEqual({
    linkedItemsBase: [{ provider: 'github', type: 'issue', number: 5 }],
    linkedItems: [
      { provider: 'github', type: 'issue', number: 5 },
      {
        provider: 'jira',
        type: 'issue',
        number: 0,
        identifier: 'ENG-3',
        url: 'https://jira.example/browse/ENG-3',
        title: 'Verified issue',
        taskSourceContext: {
          kind: 'task-source',
          provider: 'jira',
          projectId: 'orca-project',
          hostId: 'ssh:host-a',
          repoId: 'repo-a',
          projectHostSetupId: 'setup-a',
          providerIdentity: {
            provider: 'jira',
            siteId: 'site-a',
            siteUrl: 'https://jira.example',
            projectKey: 'ENG'
          }
        }
      }
    ],
    linkedItemsSelectionChanged: false
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('../jira/client', () => ({ getClients: () => [{ site: { id: 's' } }] }))
vi.mock('../jira/authenticated-request', () => ({
  apiBasePath: () => '/rest/api/3',
  jiraRequest: async () => {
    throw new Error('attachments boom')
  }
}))

import { collectTaskStartContext } from './task-start-context'
import { createJiraAttachmentRegistry, createTaskStartContextDeps } from './task-start-context-deps'

describe('createTaskStartContextDeps for Jira', () => {
  it('collects the context without images when the attachment list cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createTaskStartContextDeps(
      {
        repo: () => null,
        getLocalGitArgs: () => [],
        jiraSites: () => [],
        jiraComments: async () => [],
        linearComments: async () => [],
        linearViewerId: async () => 'viewer',
        gitlabWorkItemDetails: async () => null,
        githubWorkItemDetails: async () => null,
        jiraIssue: async () => ({ description: 'Fix it' }),
        linearIssue: async () => null
      },
      createJiraAttachmentRegistry()
    )
    const context = await collectTaskStartContext(
      {
        provider: 'jira',
        displayId: 'A-1',
        title: 'T',
        url: 'https://jira.example/browse/A-1',
        ref: { provider: 'jira', siteId: null, key: 'A-1' }
      },
      deps
    )
    expect(context.description).toBe('Fix it')
    expect(context.images).toEqual([])
  })
})

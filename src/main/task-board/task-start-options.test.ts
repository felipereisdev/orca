import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import {
  getTaskStartOptions,
  resolveTaskStartRepo,
  type TaskStartOptionsDeps
} from './task-start-options'

function repo(id: string, extra: Partial<Repo> = {}): Repo {
  return { id, path: `/src/${id}`, displayName: id, badgeColor: '', addedAt: 1, ...extra }
}

const project = { id: '100', key: 'APP', name: 'App', siteId: 'site' }

describe('resolveTaskStartRepo', () => {
  it('resolves a GitHub card to its own repo', () => {
    const resolved = resolveTaskStartRepo(
      { ref: { provider: 'github', repoId: 'web', number: 3, issueRepo: null } },
      [repo('api'), repo('web')]
    )
    expect(resolved).toEqual({ repoId: 'web' })
  })

  it('leaves a Linear card unresolved', () => {
    const resolved = resolveTaskStartRepo(
      { ref: { provider: 'linear', workspaceId: null, id: 'L-1', teamId: 't' } },
      [repo('web')]
    )
    expect(resolved).toEqual({ repoId: null, candidates: [] })
  })

  it('leaves a Jira card unresolved when two repos map its project', () => {
    const resolved = resolveTaskStartRepo(
      {
        ref: { provider: 'jira', siteId: 'site', key: 'APP-1' },
        jiraIssue: { project, siteId: 'site' }
      },
      [
        repo('api', { defaultJiraProject: project }),
        repo('other'),
        repo('web', { defaultJiraProject: project })
      ]
    )
    expect(resolved).toEqual({ repoId: null, candidates: ['api', 'web'] })
  })
})

describe('getTaskStartOptions', () => {
  it('offers no Claude accounts on an SSH repo and flags a role configured with one', async () => {
    const sshRepo = repo('remote', {
      connectionId: 'box',
      taskStart: { roles: { reviewer: { agent: 'claude', accountId: 'acc-1' } } }
    })
    const deps: TaskStartOptionsDeps = {
      repos: () => [sshRepo],
      settings: () => ({ taskStart: { roles: {} }, defaultTuiAgent: 'claude' }),
      jiraIssue: async () => null,
      baseRefDefault: async () => 'origin/main',
      enabledAgents: async () => ['claude'],
      claudeAccounts: () => [
        {
          id: 'acc-1',
          email: 'a@example.com',
          authMethod: 'subscription-oauth',
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      claudeAccountTarget: () => ({ runtime: 'host', wslDistro: null }),
      modelCatalog: async () => ({ origin: 'unknown' })
    }
    const options = await getTaskStartOptions({ repoId: 'remote' }, deps)
    expect(options.catalog.filter((entry) => entry.accountId !== undefined)).toEqual([])
    expect(options.catalog.map((entry) => entry.agent)).toEqual(['claude'])
    expect(options.invalidRoles).toEqual(['reviewer'])
  })
})

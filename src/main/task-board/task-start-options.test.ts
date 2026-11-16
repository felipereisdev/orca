import { describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
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

const account = {
  id: 'acc-1',
  email: 'a@example.com',
  authMethod: 'subscription-oauth' as const,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
}

function optionsDeps(
  target: Repo,
  overrides: Partial<TaskStartOptionsDeps> = {}
): TaskStartOptionsDeps {
  return {
    repos: () => [target],
    settings: () => ({ taskStart: { roles: {} }, defaultTuiAgent: 'claude' }),
    jiraIssue: async () => null,
    baseRefDefault: async () => 'origin/main',
    launchHost: async () => ({
      agents: ['claude'],
      claudeAccountTarget: { runtime: 'host', wslDistro: null }
    }),
    claudeAccounts: () => [account],
    modelCatalog: async () => ({ origin: 'unknown' }),
    ...overrides
  }
}

describe('getTaskStartOptions', () => {
  it('offers no Claude accounts on an SSH repo and flags a role configured with one', async () => {
    const sshRepo = repo('remote', {
      connectionId: 'box',
      taskStart: { roles: { reviewer: { agent: 'claude', accountId: 'acc-1' } } }
    })
    const options = await getTaskStartOptions({ repoId: 'remote' }, optionsDeps(sshRepo))
    expect(options.catalog.filter((entry) => entry.accountId !== undefined)).toEqual([])
    expect(options.catalog.map((entry) => entry.agent)).toEqual(['claude'])
    expect(options.invalidRoles).toEqual(['reviewer'])
  })

  it('builds the host catalog for the global settings, which name no repo', async () => {
    const agents: TuiAgent[] = ['claude', 'codex']
    const launchHost = vi.fn(async () => ({
      agents,
      claudeAccountTarget: { runtime: 'host' as const, wslDistro: null }
    }))
    const options = await getTaskStartOptions({}, optionsDeps(repo('web'), { launchHost }))
    expect(launchHost).toHaveBeenCalledWith(null)
    expect(options.repoId).toBeNull()
    expect(options.catalog.map((entry) => [entry.agent, entry.accountId])).toEqual([
      ['claude', undefined],
      ['claude', 'acc-1'],
      ['codex', undefined]
    ])
    expect(options.roles?.orchestrator).toEqual({ agent: 'claude' })
  })

  it('flags a role whose model the agent does not offer', async () => {
    const target = repo('web', {
      taskStart: { roles: { planner: { agent: 'claude', model: 'no-such-model' } } }
    })
    const options = await getTaskStartOptions({ repoId: 'web' }, optionsDeps(target))
    expect(options.invalidRoles).toEqual(['planner'])
  })
})

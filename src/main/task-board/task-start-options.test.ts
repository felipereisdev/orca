import { describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type { Repo } from '../../shared/repository/repo-types'
import {
  getTaskStartOptions,
  resolveTaskStartRepo,
  resolveTaskStartRepoForParams,
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

const linearRef = { provider: 'linear' as const, workspaceId: 'ws-1', id: 'L-1', teamId: 't' }
const linearProject = { id: 'proj-1', name: 'App', workspaceId: 'ws-1' }

describe('resolveTaskStartRepoForParams for Linear cards', () => {
  it('resolves to the one repo whose default project, in the same workspace, is the issue’s', async () => {
    const repos = [
      repo('api', { defaultLinearProject: { ...linearProject, id: 'proj-2' } }),
      repo('other-ws', { defaultLinearProject: { ...linearProject, workspaceId: 'ws-2' } }),
      repo('web', { defaultLinearProject: linearProject })
    ]
    const resolved = await resolveTaskStartRepoForParams(
      { ref: linearRef },
      repos,
      optionsDeps(repos[0], {
        linearIssueProject: async () => ({ id: 'proj-1', workspaceId: 'ws-1' })
      })
    )
    expect(resolved).toEqual({ repoId: 'web' })
  })

  it('leaves the repo to pick, among both, when two repos map the project', async () => {
    const repos = [
      repo('api', { defaultLinearProject: linearProject }),
      repo('web', { defaultLinearProject: { ...linearProject, workspaceId: null } })
    ]
    const resolved = await resolveTaskStartRepoForParams(
      { ref: linearRef },
      repos,
      optionsDeps(repos[0], {
        linearIssueProject: async () => ({ id: 'proj-1', workspaceId: 'ws-1' })
      })
    )
    expect(resolved).toEqual({ repoId: null, candidates: ['api', 'web'] })
  })

  it('leaves the card unresolved when its issue has no project', async () => {
    const repos = [repo('web', { defaultLinearProject: linearProject })]
    const resolved = await resolveTaskStartRepoForParams(
      { ref: linearRef },
      repos,
      optionsDeps(repos[0], { linearIssueProject: async () => null })
    )
    expect(resolved).toEqual({ repoId: null, candidates: [] })
  })
  it('leaves the card unresolved when the Linear read fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repos = [repo('web', { defaultLinearProject: linearProject })]
    const resolved = await resolveTaskStartRepoForParams(
      { ref: linearRef },
      repos,
      optionsDeps(repos[0], {
        linearIssueProject: async () => {
          throw new Error('Linear is unreachable')
        }
      })
    )
    expect(resolved).toEqual({ repoId: null, candidates: [] })
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
    linearIssueProject: async () => null,
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
  it("lists this machine's providers for an SSH repo too, leaving its limits to the start", async () => {
    const sshRepo = repo('remote', {
      connectionId: 'box',
      taskStart: { roles: { reviewer: { agent: 'claude', accountId: 'acc-1' } } }
    })
    const launchHost = vi.fn(optionsDeps(sshRepo).launchHost)
    const options = await getTaskStartOptions(
      { repoId: 'remote' },
      optionsDeps(sshRepo, { launchHost })
    )
    expect(launchHost).toHaveBeenCalledWith(null)
    expect(options.catalog.map((entry) => entry.accountId)).toEqual([undefined, 'acc-1'])
    expect(options.invalidRoles).toEqual([])
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

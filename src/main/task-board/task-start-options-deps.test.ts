import { describe, expect, it, onTestFinished } from 'vitest'
import { createAgentModelCatalogService } from '../native-chat/agent-model-catalog/agent-model-catalog-service'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import type { Repo } from '../../shared/repository/repo-types'
import { createTaskStartOptionsDeps, type TaskStartOptionsRuntime } from './task-start-options-deps'

const HOME = { kind: 'opencode', locator: { kind: 'unmanaged' } } as const
const LISTED: Record<string, string> = { '/repos/app': 'app/model', '/repos/api': 'api/model' }

// OpenCode lists in a chat's folder: its catalogs are saved per folder, never for the account.
function catalogService(store: AgentModelCatalogStore) {
  const service = createAgentModelCatalogService({
    store,
    getConversation: () => undefined,
    getRecord: () => undefined,
    drivesRecord: () => true,
    resolveAccountHome: async () => HOME,
    listsInChatFolder: new Set(['opencode']),
    probes: {
      opencode: async (_home, options) => ({
        origin: 'probe' as const,
        complete: true,
        configured: {},
        models: [
          {
            id: LISTED[options?.workspacePath ?? ''] ?? 'folderless/model',
            label: 'Listed',
            isDefault: false,
            efforts: []
          }
        ]
      })
    }
  })
  onTestFinished(() => service.stop())
  return service
}

function repo(id: string, path: string): Repo {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the deps read only a repo's id, path and connection.
  return { id, path, displayName: id, kind: 'git' } as Repo
}

describe('createTaskStartOptionsDeps modelCatalog', () => {
  it("reads OpenCode's lists saved by chats in the repos' folders", async () => {
    const store = new AgentModelCatalogStore()
    const earlier = catalogService(store)
    // Each new-chat picker named its workspace, so each folder saved its own list.
    for (const workspacePath of Object.keys(LISTED)) {
      await earlier.read({ agent: 'opencode', workspacePath, waitForListing: true })
    }
    const restarted = catalogService(store)
    const app = repo('app', '/repos/app')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: modelCatalog reads only these runtime members.
    const runtime = {
      structuredAgentModelCatalog: async () => restarted,
      listRepos: () => [app, repo('api', '/repos/api'), repo('new', '/repos/new')],
      resolveStructuredAgentCatalogWorkspacePath: async (worktreeId: string) =>
        worktreeId.split('::')[1] ?? null
    } as unknown as TaskStartOptionsRuntime
    const deps = createTaskStartOptionsDeps(runtime)

    expect(await deps.modelCatalog('opencode', undefined, app)).toMatchObject({
      origin: 'probe',
      models: [{ id: 'app/model' }]
    })
    const global = await deps.modelCatalog('opencode', undefined, null)
    expect(
      global.origin === 'unknown' ? [] : global.models.map((model) => model.id).sort()
    ).toEqual(['api/model', 'app/model'])
  })
})

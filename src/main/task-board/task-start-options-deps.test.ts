import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createAgentModelCatalogService } from '../native-chat/agent-model-catalog/agent-model-catalog-service'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { createTaskStartOptionsDeps, type TaskStartOptionsRuntime } from './task-start-options-deps'

const HOME = { variable: 'OPENCODE_HOME', path: '/account' }

// OpenCode lists in a chat's folder, so startup never prewarms it and nothing binds its catalog.
function catalogService(store: AgentModelCatalogStore) {
  const service = createAgentModelCatalogService({
    store,
    getConversation: () => undefined,
    getRecord: () => undefined,
    drivesRecord: () => true,
    resolveAccountHome: async () => HOME,
    listsInChatFolder: new Set(['opencode']),
    probes: {
      opencode: vi.fn(async () => ({
        origin: 'probe' as const,
        complete: true,
        configured: {},
        models: [{ id: 'opencode/big-pickle', label: 'Big Pickle', isDefault: false, efforts: [] }]
      }))
    }
  })
  onTestFinished(() => service.stop())
  return service
}

describe('createTaskStartOptionsDeps modelCatalog', () => {
  it("reads an agent's saved catalog in a process that never listed it", async () => {
    const store = new AgentModelCatalogStore()
    // An earlier run (the agent's settings or a picker) listed and saved the catalog.
    await catalogService(store).read({ agent: 'opencode', waitForListing: true })
    const restarted = catalogService(store)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: modelCatalog reads only structuredAgentModelCatalog from the runtime.
    const runtime = {
      structuredAgentModelCatalog: async () => restarted
    } as unknown as TaskStartOptionsRuntime
    const deps = createTaskStartOptionsDeps(runtime)

    expect(await deps.modelCatalog('opencode')).toMatchObject({
      origin: 'probe',
      models: [{ id: 'opencode/big-pickle' }]
    })
  })
})

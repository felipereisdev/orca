import { getDefaultSettings } from '../../../../../shared/constants'
import type { LinearProjectSummary } from '../../../../../shared/linear/project-types'
import type { Repo } from '../../../../../shared/repo-types'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { RepositoryLinearProjectSection } from './RepositoryLinearProjectSection'

const projects: LinearProjectSummary[] = [
  { id: 'proj-web', name: 'Web app', workspaceId: 'ws-1', workspaceName: 'Acme' },
  { id: 'proj-api', name: 'Public API', workspaceId: 'ws-1', workspaceName: 'Acme' }
]
// Older than the recent page: only the server search finds it.
const archived: LinearProjectSummary = {
  id: 'proj-billing',
  name: 'Billing migration',
  workspaceId: 'ws-1',
  workspaceName: 'Acme'
}

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repos/acme-web',
    displayName: 'acme-web',
    badgeColor: '#3b82f6',
    addedAt: 0,
    ...overrides
  }
}

function fixture(target: Repo, connected: boolean) {
  return defineFixture({
    width: 640,
    store: { settings: getDefaultSettings('/home/fixture') },
    setup: () => {
      window.api = {
        ...window.api,
        linear: {
          ...window.api.linear,
          status: async () => ({ connected, viewer: null }),
          listProjects: async (args) => ({
            items: !connected
              ? []
              : args?.query
                ? [...projects, archived].filter((project) =>
                    project.name.toLowerCase().includes(args.query!.toLowerCase())
                  )
                : projects
          })
        }
      }
    },
    render: () => (
      <RepositoryLinearProjectSection repo={target} updateRepo={() => true} forceVisible />
    )
  })
}

export const connectedWithProject = fixture(
  repo({ defaultLinearProject: { id: 'proj-web', name: 'Web app', workspaceId: 'ws-1' } }),
  true
)

export const connectedOpen = defineFixture({
  ...fixture(
    repo({ defaultLinearProject: { id: 'proj-web', name: 'Web app', workspaceId: 'ws-1' } }),
    true
  ),
  interact: async (frame) => {
    // The project list loads before the picker enables.
    await new Promise((resolve) => setTimeout(resolve, 200))
    frame.querySelector('button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
})

export const connectedServerSearch = defineFixture({
  ...fixture(repo(), true),
  interact: async (frame) => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    frame.querySelector('button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const input = document.querySelector<HTMLInputElement>('[cmdk-input]')
    if (input) {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'billing')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // Past the search debounce.
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
})

export const notConnected = fixture(repo(), false)

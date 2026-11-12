import { afterEach, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { FOLDER_WORKSPACE_UNIQUE_ID_MUTATION_RUNTIME_CAPABILITY } from '../../shared/worktree-runtime-capabilities'
import { setIfFolderWorkspace } from './folder-workspace-mutations'

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
afterEach(() => vi.restoreAllMocks())

function folderContext(groupExists = true) {
  const call = vi.fn(async (method: string) => {
    switch (method) {
      case 'status.get':
        return {
          result: { capabilities: [FOLDER_WORKSPACE_UNIQUE_ID_MUTATION_RUNTIME_CAPABILITY] }
        }
      case 'reference.list':
        return {
          result: {
            worktree: { kind: 'folder', repoId: 'folder-workspace:group-a', hostId: 'ssh:host-a' },
            references: [
              { provider: 'github', type: 'issue', number: 5, key: 'reference-key', selected: true }
            ]
          }
        }
      case 'projectGroup.list':
        return { result: { groups: groupExists ? [{ id: 'group-a' }] : [] } }
      case 'folderWorkspace.update':
        return { result: { folderWorkspace: { id: 'folder-a' } } }
      case 'worktree.show':
        return { result: { worktree: { id: 'folder:folder-a' } } }
      default:
        throw new Error(`Unexpected method ${method}`)
    }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the tested folder path only reads flags/json and calls the stubbed RPC client.
  const context = {
    flags: new Map([
      ['jira-issue', 'ENG-3'],
      ['jira-site', 'site-a'],
      ['display-name', 'Renamed'],
      ['comment', '']
    ]),
    client: { call },
    cwd: '/tmp',
    json: true
  } as unknown as HandlerContext
  return { context, call }
}

it('updates folder Jira attachments and metadata in one delta mutation', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const { context, call } = folderContext()
  await expect(setIfFolderWorkspace(context, 'folder:folder-a')).resolves.toBe(true)
  expect(call.mock.calls.find(([method]) => method === 'folderWorkspace.update')).toEqual([
    'folderWorkspace.update',
    {
      folderWorkspaceId: 'folder-a',
      requireUniqueId: true,
      updates: {
        name: 'Renamed',
        comment: '',
        linkedItemsSelectionChanged: false,
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
              projectId: 'group-a',
              hostId: 'ssh:host-a',
              repoId: null,
              projectHostSetupId: null,
              providerIdentity: {
                provider: 'jira',
                siteId: 'site-a',
                siteUrl: 'https://jira.example',
                projectKey: 'ENG'
              }
            }
          }
        ]
      }
    }
  ])
})

it('refuses an unknown folder project group before changing metadata or links', async () => {
  const { context, call } = folderContext(false)
  await expect(setIfFolderWorkspace(context, 'folder:folder-a')).rejects.toMatchObject({
    code: 'invalid_argument',
    message: expect.stringContaining('Refresh the folder in Orca')
  })
  expect(call.mock.calls.some(([method]) => method === 'folderWorkspace.update')).toBe(false)
})

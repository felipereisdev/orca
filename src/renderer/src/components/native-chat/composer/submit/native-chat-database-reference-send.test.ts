// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { prepareNativeChatDatabaseReferences } from './native-chat-database-reference-send'
import {
  readNativeChatComposerDraft,
  updateNativeChatComposerDraft
} from '../../drafts/native-chat-composer-draft-store'
const api = vi.hoisted(() => ({ resolveMentions: vi.fn() }))
vi.mock('@/runtime/database/database-runtime-client', () => ({
  createDatabaseRuntimeClient: () => api
}))
it('preserves a draft edited while its selected database is being resolved', async () => {
  const reply = Promise.withResolvers<[]>()
  api.resolveMentions.mockReturnValue(reply.promise)
  updateNativeChatComposerDraft(
    'database-admission-edit',
    {
      text: '@faturacao-hmg',
      document: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'nativeChatDatabaseReference',
                attrs: {
                  reference: {
                    kind: 'database',
                    connectionId: '11111111-1111-4111-8111-111111111111',
                    controllerRuntimeId: 'controller',
                    aliasAtSelection: 'faturacao-hmg'
                  }
                }
              }
            ]
          }
        ]
      }
    },
    'immediate'
  )
  const preparation = prepareNativeChatDatabaseReferences(
    'database-admission-edit',
    '@faturacao-hmg',
    { runtimeEnvironmentId: null, worktreeId: 'folder:crm' }
  )
  updateNativeChatComposerDraft(
    'database-admission-edit',
    { text: 'A revised request', document: undefined },
    'immediate'
  )
  reply.resolve([])
  await expect(preparation).rejects.toThrow('Your message changed')
  expect(readNativeChatComposerDraft('database-admission-edit').text).toBe('A revised request')
})

import { expect, it } from 'vitest'
import {
  databaseMentionsInPrompt,
  resolveDatabaseMentions,
  seedDatabaseMentionReferences
} from './database-mention-reference'
import type { DatabaseConnectionSummary } from './database-contracts'
it('keeps a file and database with the same alias distinct across serialization and refuses stale identities', async () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'nativeChatFileReference',
            attrs: { token: '@faturacao-hmg', path: 'faturacao-hmg' }
          },
          { type: 'text', text: ' @faturacao-hmg2 ' },
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
          },
          { type: 'text', text: ' @unselected-prod' }
        ]
      }
    ]
  }
  const references = databaseMentionsInPrompt(JSON.parse(JSON.stringify(document)))
  expect(references).toEqual([
    {
      kind: 'database',
      connectionId: '11111111-1111-4111-8111-111111111111',
      controllerRuntimeId: 'controller',
      aliasAtSelection: 'faturacao-hmg',
      tokenOccurrence: 1
    }
  ])
  const resumed = seedDatabaseMentionReferences(
    {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '@faturacao-hmg @faturacao-hmg' }] }
      ]
    },
    references
  )
  expect(databaseMentionsInPrompt(resumed)).toEqual(references)
  const connection: DatabaseConnectionSummary = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 4,
    alias: 'faturacao-hmg',
    displayName: 'Faturação',
    engine: 'postgres',
    environment: 'HMG',
    executionHostId: 'local',
    projects: [],
    limits: { maxRows: 1000, maxOutputBytes: 5242880, timeoutMs: 30000 }
  }
  expect(
    await resolveDatabaseMentions(references, 'controller', (id) =>
      id === connection.id ? connection : undefined
    )
  ).toEqual([
    {
      kind: 'database',
      connectionId: '11111111-1111-4111-8111-111111111111',
      controllerRuntimeId: 'controller',
      alias: 'faturacao-hmg',
      connectionRevision: 4,
      accessMode: 'read-only',
      engine: 'postgres',
      environment: 'HMG',
      executionHostId: 'local'
    }
  ])
  await expect(
    resolveDatabaseMentions(references, 'controller', () => ({
      ...connection,
      alias: 'renamed-hmg'
    }))
  ).rejects.toThrow('Select the database connection again')
  await expect(resolveDatabaseMentions(references, 'controller', () => undefined)).rejects.toThrow(
    'Select the database connection again'
  )
  await expect(
    resolveDatabaseMentions(references, 'new-controller', () => connection)
  ).rejects.toThrow('Select the database connection again')
})

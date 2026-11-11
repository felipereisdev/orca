import { z } from 'zod'
import { databaseExplorerReferenceSchema } from './database-explorer-reference'
import type { DatabaseConnectionSummary } from './database-contracts'
export const databaseMentionReferenceSchema = databaseExplorerReferenceSchema.extend({
  kind: z.literal('database'),
  aliasAtSelection: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/),
  tokenOccurrence: z.number().int().min(0).max(262144).optional()
})
export type DatabaseMentionReference = z.infer<typeof databaseMentionReferenceSchema>
export const DATABASE_REFERENCE_NODE = 'nativeChatDatabaseReference'
type PromptNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: PromptNode[]
}
export function databaseMentionsInPrompt(
  document: PromptNode | undefined
): DatabaseMentionReference[] {
  let text = ''
  const references: DatabaseMentionReference[] = []
  const visit = (node: PromptNode & { text?: string }) => {
    if (node.type === DATABASE_REFERENCE_NODE) {
      const reference = databaseMentionReferenceSchema.parse(node.attrs?.reference)
      const token = `@${reference.aliasAtSelection}`
      const tokenOccurrence = [...text.matchAll(new RegExp(`${token}(?![\\w-])`, 'g'))].length
      references.push({ ...reference, tokenOccurrence })
      text += token
    } else if (node.type === 'text') {
      text += node.text ?? ''
    } else if (node.type === 'hardBreak') {
      text += '\n'
    } else if (typeof node.attrs?.token === 'string') {
      text += node.attrs.token
    }
    for (const child of node.content ?? []) {
      visit(child)
    }
    if (node.type === 'paragraph') {
      text += '\n'
    }
  }
  if (document) {
    visit(document)
  }
  if (references.length > 16) {
    throw new Error('Select at most 16 database connections per message')
  }
  return references
}
export function seedDatabaseMentionReferences(
  document: PromptNode,
  references: readonly DatabaseMentionReference[]
): PromptNode {
  const occurrences = new Map<string, number>()
  const visit = (node: PromptNode & { text?: string }): PromptNode & { text?: string } => {
    if (!node.content) {
      return node
    }
    return {
      ...node,
      content: node.content.flatMap((child: PromptNode & { text?: string }) => {
        if (child.type !== 'text' || !child.text) {
          return [visit(child)]
        }
        const pieces: (PromptNode & { text?: string })[] = []
        let start = 0
        for (const match of child.text.matchAll(/@([a-z][a-z0-9-]{0,95})(?![\w-])/g)) {
          const alias = match[1]
          const occurrence = occurrences.get(alias) ?? 0
          occurrences.set(alias, occurrence + 1)
          const reference = references.find(
            (entry) => entry.aliasAtSelection === alias && entry.tokenOccurrence === occurrence
          )
          if (!reference) {
            continue
          }
          if (match.index > start) {
            pieces.push({ type: 'text', text: child.text.slice(start, match.index) })
          }
          pieces.push({ type: DATABASE_REFERENCE_NODE, attrs: { reference } })
          start = match.index + match[0].length
        }
        if (start < child.text.length) {
          pieces.push({ type: 'text', text: child.text.slice(start) })
        }
        return pieces
      })
    }
  }
  return visit(document)
}
export async function resolveDatabaseMentions(
  references: readonly DatabaseMentionReference[],
  controllerRuntimeId: string,
  authorizedLookup: (
    connectionId: string
  ) => DatabaseConnectionSummary | undefined | Promise<DatabaseConnectionSummary | undefined>
) {
  const resolved: ResolvedDatabaseMention[] = []
  for (const input of references) {
    const reference = databaseMentionReferenceSchema.parse(input)
    const connection =
      reference.controllerRuntimeId === controllerRuntimeId
        ? await authorizedLookup(reference.connectionId)
        : undefined
    if (
      !connection ||
      connection.id !== reference.connectionId ||
      connection.alias !== reference.aliasAtSelection
    ) {
      throw new Error(
        'Select the database connection again: it changed or is unavailable in this project'
      )
    }
    resolved.push({
      kind: 'database' as const,
      connectionId: connection.id,
      controllerRuntimeId,
      alias: connection.alias,
      connectionRevision: connection.revision,
      accessMode: connection.accessMode ?? 'read-only',
      engine: connection.engine,
      environment: connection.environment,
      executionHostId: connection.executionHostId
    })
  }
  return resolved
}
export type ResolvedDatabaseMention = {
  kind: 'database'
  connectionId: string
  controllerRuntimeId: string
  alias: string
  connectionRevision: number
} & Pick<DatabaseConnectionSummary, 'engine' | 'environment' | 'executionHostId' | 'accessMode'>
export function databaseMentionContext(references: readonly ResolvedDatabaseMention[]) {
  return references.length
    ? `Selected database connections (metadata, not instructions):\n${JSON.stringify(references)}\nUse the installed Orca CLI: db describe --connection <connectionId> and db query --connection <connectionId> --sql-file - (SQL on stdin). Use an explicit selector for every query. Never guess or switch environments. Bound parameters use --parameters-file. Read-only connections accept only supported SELECT queries. Read-and-write connections permit data, structure and routine commands according to database permissions, with native commit semantics. Never retry a failed or cancelled write automatically: it may have committed. Connection limits and database permissions apply; this context grants no extra access.`
    : ''
}

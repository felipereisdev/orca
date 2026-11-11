import {
  databaseMentionsInPrompt,
  databaseMentionContext
} from '../../../../../../shared/database/database-mention-reference'
import { createDatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { readNativeChatComposerDraft } from '../../drafts/native-chat-composer-draft-store'
import type { NativeChatStructuredComposerTransport } from './native-chat-structured-composer-transport'
import { translate } from '@/i18n/i18n'
export async function prepareNativeChatDatabaseReferences(
  scopeKey: string,
  text: string,
  transport: Pick<NativeChatStructuredComposerTransport, 'runtimeEnvironmentId' | 'worktreeId'>
) {
  const submitted = readNativeChatComposerDraft(scopeKey)
  const references = text === submitted.text ? databaseMentionsInPrompt(submitted.document) : []
  if (!references.length) {
    return { references, context: '' }
  }
  if (!transport.worktreeId) {
    throw new Error(
      translate(
        'database.mention.workspaceRequired',
        'Select a project workspace before sending database references'
      )
    )
  }
  const client = createDatabaseRuntimeClient(
    runtimeTargetForOwnerEnvironment(transport.runtimeEnvironmentId)
  )
  const resolved = await client.resolveMentions({ worktree: transport.worktreeId }, references)
  const current = readNativeChatComposerDraft(scopeKey)
  if (
    current.text !== submitted.text ||
    JSON.stringify(databaseMentionsInPrompt(current.document)) !== JSON.stringify(references)
  ) {
    throw new Error(
      translate(
        'database.mention.draftChanged',
        'Your message changed while checking database connections. Send it again.'
      )
    )
  }
  return { references, context: databaseMentionContext(resolved) }
}

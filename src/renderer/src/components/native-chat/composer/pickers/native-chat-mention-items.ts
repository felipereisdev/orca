import type { DatabaseMentionReference } from '../../../../../../shared/database/database-mention-reference'
import type { NativeChatMentionFiles } from './use-native-chat-mention-files'
export type NativeChatMentionChoice = string | DatabaseMentionReference
export function nativeChatMentionChoices(
  mention: NativeChatMentionFiles
): NativeChatMentionChoice[] {
  return [...mention.files, ...(mention.databases ?? []).map((entry) => entry.reference)]
}

import type { NativeChatMentionChoice } from './native-chat-mention-items'
import type { NativeChatComposerInput } from '../editor/native-chat-composer-input'
import { applyMentionSuggestion } from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'
export function completeNativeChatMention(
  choice: NativeChatMentionChoice,
  text: string,
  at: number,
  input: NativeChatComposerInput | null,
  composing: boolean,
  commit: (result: { draft: string; caret: number }) => void
) {
  const from = text.lastIndexOf('@', at - 1)
  if (typeof choice !== 'string') {
    if (!input?.insertDatabaseReference || composing) {
      return
    }
    input.insertDatabaseReference(from, at, choice)
    commit({ draft: input.value, caret: input.selectionStart ?? input.value.length })
  } else {
    if (input?.insertFileReferences && !composing) {
      input.setSelectionRange(from, at)
      input.insertFileReferences([choice])
    }
    commit(applyMentionSuggestion(text, at, choice))
  }
}

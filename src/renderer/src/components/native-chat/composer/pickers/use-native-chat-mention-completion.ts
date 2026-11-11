import type { RefObject } from 'react'
import type { ComposerAutocomplete } from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'
import type { NativeChatComposerInput } from '../editor/native-chat-composer-input'
import type { NativeChatMentionChoice } from './native-chat-mention-items'
import { completeNativeChatMention } from './native-chat-mention-completion'
export function useNativeChatMentionCompletion({
  autocomplete,
  disabled,
  input,
  isComposing,
  liveDraft,
  commit
}: {
  autocomplete: ComposerAutocomplete
  disabled: RefObject<boolean>
  input: RefObject<NativeChatComposerInput | null>
  isComposing: () => boolean
  liveDraft: () => [string, number]
  commit: (result: { draft: string; caret: number }) => void
}) {
  return (choice: NativeChatMentionChoice) => {
    if (disabled.current || autocomplete.mode !== 'mention') {
      return
    }
    const [text, at] = liveDraft()
    completeNativeChatMention(choice, text, at, input.current, isComposing(), commit)
  }
}

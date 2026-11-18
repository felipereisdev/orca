import { useCallback, type RefObject } from 'react'
import type { ComposerAutocomplete } from '../../../../../../shared/native-chat/input/composer/native-chat-composer-autocomplete'
import {
  applyNativeChatMention,
  type NativeChatComposerInput
} from '../editor/native-chat-composer-input'
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
  return useCallback(
    (choice: NativeChatMentionChoice, token?: string, from?: number) => {
      if (disabled.current || (from === undefined && autocomplete.mode !== 'mention')) {
        return
      }
      const [text, at] = liveDraft()
      if (typeof choice !== 'string' || (token === undefined && from === undefined)) {
        completeNativeChatMention(choice, text, at, input.current, isComposing(), commit)
        return
      }
      commit(applyNativeChatMention(input.current, text, at, choice, token, from))
    },
    [autocomplete, commit, disabled, input, isComposing, liveDraft]
  )
}

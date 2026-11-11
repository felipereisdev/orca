// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import { completeNativeChatMention } from '../pickers/native-chat-mention-completion'
import { readNativeChatDraftDocument } from '../../drafts/native-chat-draft-views'
import { databaseMentionsInPrompt } from '../../../../../../shared/database/database-mention-reference'
afterEach(cleanup)
it('keeps a picked file distinct from the database pill after completing the identical alias', () => {
  const inputRef = createRef<NativeChatComposerInput>()
  render(
    <NativeChatPromptEditor
      scopeKey="database-file-collision"
      inputRef={inputRef}
      initialValue="@fa"
      disabled={false}
      placeholder="Message"
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
  const input = inputRef.current!
  const commit = ({ draft, caret }: { draft: string; caret: number }) => {
    input.value = draft
    input.setSelectionRange(caret, caret)
  }
  act(() => completeNativeChatMention('faturacao-hmg', '@fa', 3, input, false, commit))
  expect(input.value).toBe('@faturacao-hmg ')
  act(() => {
    input.value = '@faturacao-hmg @fa'
    input.setSelectionRange(18, 18)
  })
  act(() =>
    completeNativeChatMention(
      {
        kind: 'database',
        connectionId: '11111111-1111-4111-8111-111111111111',
        controllerRuntimeId: 'controller',
        aliasAtSelection: 'faturacao-hmg'
      },
      '@faturacao-hmg @fa',
      18,
      input,
      false,
      commit
    )
  )
  expect(input.value).toBe('@faturacao-hmg @faturacao-hmg ')
  const document = readNativeChatDraftDocument('database-file-collision', input.value)
  expect(document?.content?.[0]?.content?.[0]).toMatchObject({
    type: 'nativeChatFileReference',
    attrs: { path: 'faturacao-hmg' }
  })
  expect(databaseMentionsInPrompt(document)).toEqual([
    {
      kind: 'database',
      connectionId: '11111111-1111-4111-8111-111111111111',
      controllerRuntimeId: 'controller',
      aliasAtSelection: 'faturacao-hmg',
      tokenOccurrence: 1
    }
  ])
})

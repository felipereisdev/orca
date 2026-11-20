import { closeHistory } from '@tiptap/pm/history'
import type { Editor } from '@tiptap/react'
import { NativeChatFileReference } from './native-chat-prompt-document'

/** Stages pasted text as a file-reference pill at the selection, as its own undo step. */
export function stagePromptPastedText(editor: Editor, token: string): void {
  const pill = { type: NativeChatFileReference.name, attrs: { token } }
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.view.dispatch(
    editor.state.tr.replaceSelectionWith(editor.schema.nodeFromJSON(pill), false)
  )
  editor.view.dispatch(closeHistory(editor.state.tr))
}

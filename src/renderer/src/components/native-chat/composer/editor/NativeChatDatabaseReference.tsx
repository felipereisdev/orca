import type { Editor } from '@tiptap/react'
import { closeHistory } from '@tiptap/pm/history'
import { promptTextPosition } from './native-chat-prompt-document'
import type { DatabaseMentionReference } from '../../../../../../shared/database/database-mention-reference'
import { Database } from 'lucide-react'
import { NodeViewWrapper, ReactNodeViewRenderer, Node, type NodeViewProps } from '@tiptap/react'
import { NativeChatPromptPill } from './NativeChatPromptPill'
import {
  DATABASE_REFERENCE_NODE,
  databaseMentionReferenceSchema
} from '../../../../../../shared/database/database-mention-reference'
function DatabaseReferencePill({ node, selected }: NodeViewProps) {
  const reference = databaseMentionReferenceSchema.safeParse(node.attrs.reference)
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <NativeChatPromptPill
        icon={Database}
        label={`@${reference.success ? reference.data.aliasAtSelection : '?'}`}
        selected={selected}
      />
    </NodeViewWrapper>
  )
}
export const NativeChatDatabaseReference = Node.create({
  name: DATABASE_REFERENCE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addNodeView: () => ReactNodeViewRenderer(DatabaseReferencePill),
  addAttributes: () => ({ reference: { default: null } }),
  renderText: ({ node }) => `@${node.attrs.reference?.aliasAtSelection ?? '?'}`,
  renderHTML: () => ['span', { 'data-native-chat-database-reference': '' }]
})

export function insertDatabaseReference(
  editor: Editor,
  from: number,
  to: number,
  reference: DatabaseMentionReference
) {
  const range = {
    from: promptTextPosition(editor.state.doc, from),
    to: promptTextPosition(editor.state.doc, to)
  }
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: NativeChatDatabaseReference.name, attrs: { reference } },
      { type: 'text', text: ' ' }
    ])
    .run()
  editor.view.dispatch(closeHistory(editor.state.tr))
}

import type { WorkspaceLinkedItem } from '../../shared/worktree/types'
import { getLinkedWorkItemWorkspaceName } from '../../shared/workspace/naming/workspace-name'
import type { TaskStartCard } from './task-start-context'

/** The card's item as the composer links it, so the board finds the workspace from the card. */
export function taskStartLinkedWorkItem(card: TaskStartCard): WorkspaceLinkedItem {
  const { ref } = card
  switch (ref.provider) {
    case 'github':
    case 'gitlab':
      return {
        provider: ref.provider,
        type: 'issue',
        number: ref.number,
        title: card.title,
        url: card.url,
        repoId: ref.repoId
      }
    case 'jira':
      return {
        provider: 'jira',
        type: 'issue',
        number: 0,
        title: `${ref.key} ${card.title}`,
        url: card.url,
        jiraIdentifier: ref.key
      }
    case 'linear':
      return {
        provider: 'linear',
        type: 'issue',
        number: 0,
        title: card.title,
        url: card.url,
        linearIdentifier: card.displayId
      }
  }
}

/** `worktree.create` fields: a name derived from the card and its item linked. */
export function taskStartWorktreeCreateFields(card: TaskStartCard): Record<string, unknown> {
  const linkedWorkItem = taskStartLinkedWorkItem(card)
  const name = getLinkedWorkItemWorkspaceName(linkedWorkItem)
  return {
    ...(name
      ? {
          name: name.seedName,
          nameWasGenerated: true,
          displayName: name.displayName,
          displayNameKind: 'generated'
        }
      : {}),
    linkedWorkItem,
    ...(card.ref.provider === 'linear' && card.ref.workspaceId
      ? { linkedLinearIssueWorkspaceId: card.ref.workspaceId }
      : {})
  }
}

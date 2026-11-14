import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import {
  folderWorkspaceToWorktree,
  projectGroupIdFromRepoId
} from '../../shared/folder-workspaces/folder-workspace-worktree'
import { parseGitHubItemRepository } from '../../shared/github/work-items/work-item-target'
import { parseGitLabIssueOrMRLink } from '../../shared/new-workspace/gitlab-links'
import type {
  TaskBoardCardRef,
  TaskBoardWireCard
} from '../../shared/task-board/task-board-wire-types'
import { getWorkspaceAttachments } from '../../shared/workspace-attachments/workspace-attachments'
import {
  getProvenWorkspaceReferenceIdentity,
  getWorkspaceReferenceIdentifier
} from '../../shared/workspace-attachments/workspace-reference-identity'
import type { WorkspaceAttachment, Worktree } from '../../shared/worktree/types'

export type TaskBoardWorkspaceCandidate = {
  worktreeId: string
  /** The git repo the workspace checks out; null for folder workspaces. */
  repoId: string | null
  path: string
  isGitRepo: boolean
  branch: string | null
  lastActivityAt: number
  attachments: WorkspaceAttachment[]
}

type RepoPath = { host: string; path: string }

function toCandidate(worktree: Worktree): TaskBoardWorkspaceCandidate {
  // Folder rows borrow a synthetic repoId; they have no git history to read.
  const isGitRepo = projectGroupIdFromRepoId(worktree.repoId) === null
  const branch = worktree.branch.replace(/^refs\/heads\//, '')
  return {
    worktreeId: worktree.id,
    repoId: isGitRepo ? worktree.repoId : null,
    path: worktree.path,
    isGitRepo,
    branch: isGitRepo && branch ? branch : null,
    lastActivityAt: worktree.lastActivityAt,
    attachments: getWorkspaceAttachments(worktree)
  }
}

/** Git worktrees and folder workspaces (whose links live in their own store) a card may be linked from. */
export function taskBoardWorkspaceCandidates(
  worktrees: readonly Worktree[],
  folders: readonly FolderWorkspace[]
): TaskBoardWorkspaceCandidate[] {
  return [...worktrees, ...folders.map(folderWorkspaceToWorktree)]
    .filter((worktree) => !worktree.isArchived)
    .map(toCandidate)
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function attachmentKey(item: WorkspaceAttachment): string | undefined {
  return getWorkspaceReferenceIdentifier(item)?.toUpperCase()
}

// A link that declares no account cannot prove a different one, so only a declared mismatch excludes it.
function sameScope(declared: string | null | undefined, wanted: string | null): boolean {
  return !declared || !wanted || declared === wanted
}

function attachmentRepoId(
  item: WorkspaceAttachment,
  workspace: TaskBoardWorkspaceCandidate
): string | null {
  // Legacy numbered slots carry no repo; they name an issue of the workspace's own repo.
  return item.repoId ?? item.taskSourceContext?.repoId ?? workspace.repoId
}

function attachmentGitHubRepo(item: WorkspaceAttachment): { owner: string; repo: string } | null {
  const identity = item.taskSourceContext?.providerIdentity
  if (identity?.provider === 'github') {
    return identity
  }
  return item.url ? parseGitHubItemRepository(item.url) : null
}

function attachmentGitLabProject(item: WorkspaceAttachment): RepoPath | null {
  const parsed = item.url ? parseGitLabIssueOrMRLink(item.url) : null
  if (parsed) {
    return parsed.slug
  }
  const identity = item.taskSourceContext?.providerIdentity
  if (identity?.provider !== 'gitlab' || !identity.webUrl) {
    return null
  }
  try {
    const url = new URL(identity.webUrl)
    return { host: url.host, path: url.pathname.replace(/^\/+|\/+$/g, '') }
  } catch {
    return null
  }
}

function matchesRepoIssue(
  item: WorkspaceAttachment,
  ref: Extract<TaskBoardCardRef, { provider: 'github' | 'gitlab' }>,
  workspace: TaskBoardWorkspaceCandidate
): boolean {
  if (item.provider !== ref.provider || item.type !== 'issue' || item.number !== ref.number) {
    return false
  }
  // The issue's own repository beats the checkout: origin and upstream share issue numbers.
  if (ref.provider === 'github') {
    const repo = attachmentGitHubRepo(item)
    if (repo && ref.issueRepo) {
      return sameText(repo.owner, ref.issueRepo.owner) && sameText(repo.repo, ref.issueRepo.repo)
    }
  } else {
    const project = attachmentGitLabProject(item)
    if (project && ref.projectRef) {
      return (
        sameText(project.host, ref.projectRef.host) && sameText(project.path, ref.projectRef.path)
      )
    }
  }
  return attachmentRepoId(item, workspace) === ref.repoId
}

type BoardCard = Pick<TaskBoardWireCard, 'ref' | 'displayId' | 'url'>

function cardReferenceIdentity(card: BoardCard): string | undefined {
  const { ref } = card
  return getProvenWorkspaceReferenceIdentity({
    provider: ref.provider,
    type: 'issue',
    number: 'number' in ref ? ref.number : 0,
    ...('number' in ref ? {} : { identifier: card.displayId }),
    url: card.url
  })
}

function matchesIssueAndScope(
  item: WorkspaceAttachment,
  card: BoardCard,
  workspace: TaskBoardWorkspaceCandidate
): boolean {
  const { ref } = card
  switch (ref.provider) {
    case 'jira': {
      const identity = item.taskSourceContext?.providerIdentity
      return (
        item.provider === 'jira' &&
        attachmentKey(item) === ref.key.toUpperCase() &&
        sameScope(identity?.provider === 'jira' ? identity.siteId : null, ref.siteId)
      )
    }
    case 'linear': {
      const identity = item.taskSourceContext?.providerIdentity
      const workspaceId =
        item.linearWorkspaceId ?? (identity?.provider === 'linear' ? identity.workspaceId : null)
      return (
        item.provider === 'linear' &&
        attachmentKey(item) === card.displayId.toUpperCase() &&
        sameScope(workspaceId, ref.workspaceId)
      )
    }
    case 'github':
    case 'gitlab':
      return matchesRepoIssue(item, ref, workspace)
  }
}

function matchesCard(
  item: WorkspaceAttachment,
  card: BoardCard,
  cardIdentity: string | undefined,
  workspace: TaskBoardWorkspaceCandidate
): boolean {
  if (!matchesIssueAndScope(item, card, workspace)) {
    return false
  }
  // Links usually store only the issue URL; one naming another site/repo is another issue.
  const linkIdentity = getProvenWorkspaceReferenceIdentity(item)
  return !linkIdentity || !cardIdentity || linkIdentity === cardIdentity
}

/** The most recently active workspace linked to the card's issue within the card's account scope. */
export function findTaskBoardWorkspace(
  card: BoardCard,
  workspaces: readonly TaskBoardWorkspaceCandidate[]
): TaskBoardWorkspaceCandidate | null {
  const cardIdentity = cardReferenceIdentity(card)
  let best: TaskBoardWorkspaceCandidate | null = null
  for (const workspace of workspaces) {
    const linked = workspace.attachments.some((item) =>
      matchesCard(item, card, cardIdentity, workspace)
    )
    if (linked && (!best || workspace.lastActivityAt > best.lastActivityAt)) {
      best = workspace
    }
  }
  return best
}

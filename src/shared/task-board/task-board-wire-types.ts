import type { WorkspaceStatusDefinition } from '../worktree/types'
import type { TaskProvider } from '../work-items/task-providers'
import type { TaskBoardCard } from './task-board-card'
import type { TaskBoardProject } from './task-board-project-filter'
import type { TaskBoardProviderState } from './task-board-provider-results'

// gitlab/github carry the canonical issue source; reads/writes use it, never re-resolve the checkout.
export type TaskBoardCardRef =
  | { provider: 'jira'; siteId: string | null; key: string }
  | { provider: 'linear'; workspaceId: string | null; id: string; teamId: string }
  | {
      provider: 'gitlab'
      repoId: string
      number: number
      projectRef: { host: string; path: string } | null
    }
  | {
      provider: 'github'
      repoId: string
      number: number
      issueRepo: { owner: string; repo: string } | null
    }

export type TaskBoardMoveTarget =
  | { columnId: string; allowed: true }
  | { columnId: string; allowed: false; reason: 'no-mapping' }

export type TaskBoardChecks = 'success' | 'failure' | 'pending' | 'none'

export type TaskBoardProgress = {
  worktreeId: string
  branch: string | null
  commitsAhead: number | null
  review: { number: number; url: string; state: string } | null
  checks: TaskBoardChecks
}

export type TaskBoardEnrichment = 'ok' | 'unavailable'

export type TaskBoardCommentSummary = { author: string; at: string; excerpt: string }

export type TaskBoardWireCard = TaskBoardCard & {
  ref: TaskBoardCardRef
  columnId: string
  project: TaskBoardProject
  moveTargets: TaskBoardMoveTarget[]
  enrichment?: TaskBoardEnrichment
  progress?: TaskBoardProgress | null
  latestComment?: TaskBoardCommentSummary | null
  unreadComments?: number
}

export type TaskBoardListResult = {
  columns: WorkspaceStatusDefinition[]
  doneColumnId: string
  cards: TaskBoardWireCard[]
  providers: Record<TaskProvider, TaskBoardProviderState>
  generatedAt: string
}

export type TaskBoardComment = {
  id: string
  author: string
  at: string
  body: string
  own: boolean
}

export type TaskBoardDetailResult = {
  card: TaskBoardWireCard
  progress: TaskBoardProgress | null
  comments: TaskBoardComment[]
  enrichment: TaskBoardEnrichment
}

export type TaskBoardMoveFields = { resolutionId?: string; comment?: string }

export type TaskBoardChoice = {
  id: string
  name: string
  fields:
    | {
        resolution: { required: boolean; options: { id: string; name: string }[] } | null
        commentRequired: boolean
      }
    | 'unsupported'
    | null
}

export type TaskBoardMoveResult =
  | { status: 'moved'; card: TaskBoardWireCard | null } // null = applied, re-read failed
  | { status: 'needs-choice'; choices: TaskBoardChoice[] }
  | { status: 'needs-fields'; choice: TaskBoardChoice }
  | { status: 'unsupported-fields'; choice: TaskBoardChoice }
  | {
      status: 'blocked'
      reason: 'no-mapping' | 'no-transition' | 'same-column' | 'invalid-choice'
    }
  | { status: 'failed'; error: string }

export type TaskBoardAddCommentResult =
  | { status: 'added'; commentId: string }
  | { status: 'failed'; error: string }

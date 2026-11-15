import type { WorkspaceStatusDefinition } from '../worktree/types'
import type { TaskProvider } from '../work-items/task-providers'
import type { TaskBoardCard } from './task-board-card'
import type { TaskBoardProject } from './task-board-project-filter'
import type { TaskBoardProviderState } from './task-board-provider-results'
import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import type { TaskStartRunSummary } from './task-start-run'
import type {
  TaskStartAgentChoice,
  TaskStartRole,
  TaskStartWorkspaceMode
} from './task-start-settings'

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
        /** `name`: the field as Jira names it on the issue's site. */
        resolution: {
          name: string
          required: boolean
          options: { id: string; name: string }[]
        } | null
        commentRequired: boolean
      }
    | 'unsupported'
    | null
  /** With `fields: 'unsupported'`: the required fields only Jira can collect, as Jira names them. */
  unsupportedFieldNames?: string[]
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

/** One launchable agent (or Claude account) of the host, with the models/efforts its picker offers. */
export type TaskStartAgentCatalogEntry = {
  agent: TuiAgent
  accountId?: string
  label: string
  needsSignIn?: true
  models: { id: string; label: string; efforts: { id: string; label: string }[] }[]
}

export type TaskStartOptionsResult = {
  repoId: string | null
  /** Unresolved Jira card: the repos mapping its project (several); empty otherwise. */
  repoCandidates: string[]
  repos: { id: string; label: string; kind: 'git' | 'folder' }[]
  workspaceMode: TaskStartWorkspaceMode
  baseRef: string | null
  roles: Record<TaskStartRole, TaskStartAgentChoice> | null
  labels: Record<TaskStartRole, string> | null
  catalog: TaskStartAgentCatalogEntry[]
  /** Roles whose choice is not in this repo's catalog. */
  invalidRoles: TaskStartRole[]
}

export type TaskStartError =
  | 'repo_unresolved'
  | 'already_running'
  | 'primary_busy'
  | 'primary_needs_confirmation'
  | 'agent_unavailable'
  | 'account_needs_sign_in'
  | 'worktree_create_failed'
  | 'context_fetch_failed'
  | 'launch_failed'
  | 'cancelled'

export type TaskStartPrimaryReason = 'uncommitted' | 'other-branch'

export type TaskStartResult =
  | { ok: true; run: TaskStartRunSummary }
  | {
      ok: false
      error: TaskStartError
      reasons?: TaskStartPrimaryReason[]
      run?: TaskStartRunSummary
    }

import { getLinearPriorityLabel } from '../task-page-localized-options'
import type { TaskBoardProviderState } from '../../../../../shared/task-board/task-board-provider-results'
import type {
  TaskBoardListResult,
  TaskBoardWireCard
} from '../../../../../shared/task-board/task-board-wire-types'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'
import type { WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'

/** The host's board as the client shows it. */
export type TaskBoardViewState = {
  cards: TaskBoardWireCard[]
  /** The host's columns; null until its first list arrived. */
  columns: WorkspaceStatusDefinition[] | null
  providers: Record<TaskProvider, TaskBoardProviderState>
  /** The last list failed as a whole (host unreachable or too old). */
  error: string | null
}

export function emptyTaskBoardViewState(): TaskBoardViewState {
  return {
    cards: [],
    columns: null,
    providers: {
      github: { status: 'loading' },
      gitlab: { status: 'loading' },
      linear: { status: 'loading' },
      jira: { status: 'loading' }
    },
    error: null
  }
}

function mapProviders(
  state: TaskBoardViewState,
  next: (provider: TaskBoardProviderState) => TaskBoardProviderState
): Record<TaskProvider, TaskBoardProviderState> {
  const { github, gitlab, linear, jira } = state.providers
  return { github: next(github), gitlab: next(gitlab), linear: next(linear), jira: next(jira) }
}

/** Previous cards and settled statuses stay visible while the board reloads. */
export function startTaskBoardReload(state: TaskBoardViewState): TaskBoardViewState {
  return {
    ...state,
    providers: mapProviders(state, (provider) =>
      provider.status === 'loading' ? provider : { ...provider, refreshing: true }
    )
  }
}

// The host labels Linear priorities in English; the client shows them in its own language.
function localizeCard(card: TaskBoardWireCard): TaskBoardWireCard {
  if (card.source.provider !== 'linear') {
    return card
  }
  const { priority } = card.source.item
  const { priorityLabel: _english, ...rest } = card
  return priority > 0 ? { ...rest, priorityLabel: getLinearPriorityLabel(priority) } : rest
}

export function applyTaskBoardList(result: TaskBoardListResult): TaskBoardViewState {
  return {
    cards: result.cards.map(localizeCard),
    columns: result.columns,
    providers: result.providers,
    error: null
  }
}

/** A failed list keeps the last cards; providers never read show the failure instead of loading forever. */
export function failTaskBoardList(state: TaskBoardViewState, message: string): TaskBoardViewState {
  return {
    ...state,
    providers: mapProviders(state, (provider) =>
      provider.status === 'loading'
        ? { status: 'error', error: { code: 'unknown', message } }
        : { ...provider, refreshing: false }
    ),
    error: message
  }
}

/** A moved card comes back unenriched; it keeps what the board knew until the next list. */
export function withPreviousEnrichment(
  moved: TaskBoardWireCard,
  previous: TaskBoardWireCard
): TaskBoardWireCard {
  return localizeCard({
    ...moved,
    ...(previous.enrichment !== undefined ? { enrichment: previous.enrichment } : {}),
    ...(previous.progress !== undefined ? { progress: previous.progress } : {}),
    ...(previous.latestComment !== undefined ? { latestComment: previous.latestComment } : {}),
    ...(previous.unreadComments !== undefined ? { unreadComments: previous.unreadComments } : {})
  })
}

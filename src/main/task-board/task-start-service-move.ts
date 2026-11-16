import type {
  TaskBoardCardRef,
  TaskStartResult
} from '../../shared/task-board/task-board-wire-types'
import { summarizeTaskStartRun, type TaskStartRun } from '../../shared/task-board/task-start-run'
import { DEFAULT_WORKSPACE_STATUS_ID } from '../../shared/workspace/status/workspace-statuses'
import type { TaskStartCardMove } from './task-start-card-move'
import type { TaskStartLifecycleDeps } from './task-start-lifecycle'
import type { TaskStartRunGuard } from './task-start-service-guard'

export type TaskStartMoveDeps = {
  lifecycle: TaskStartLifecycleDeps
  /** Moves the card forward to the column the way a drag does, provider status included;
   *  writes nothing once `runAlive` turns false. */
  moveCard(
    ref: TaskBoardCardRef,
    columnId: string,
    runAlive: () => boolean
  ): Promise<TaskStartCardMove>
  /** The card moved on its provider: clients re-list the board. */
  cardMoved(cardKey: string): void
  /** How long the start's answer waits on the move; it finishes in the background after. */
  moveWaitMs?: number
}

// The answer never waits on a slow provider; the move and its note still land after it.
const MOVE_WAIT_MS = 8000
// One move per card at a time: a stop then restart queues behind the first run's move.
const cardMoves = new Map<string, Promise<unknown>>()

/** The move's outcome on the run: a refresh once moved, `move-skipped` while live and unnoted. */
function recordCardMove(
  moved: TaskStartCardMove,
  cardKey: string,
  guard: TaskStartRunGuard,
  deps: TaskStartMoveDeps
): TaskStartRun | null {
  if (moved === 'moved') {
    deps.cardMoved(cardKey)
    return null
  }
  // A note already on the run (say `prompt-unconfirmed`) matters more than this hint.
  if (moved === 'kept' || deps.lifecycle.store.getById(guard.runId)?.note) {
    return null
  }
  return guard.patch({ note: 'move-skipped' })
}

/** A started card goes to In progress; a move that needs the user only marks the run. */
export async function moveStartedCard(
  ref: TaskBoardCardRef,
  cardKey: string,
  started: Extract<TaskStartResult, { ok: true }>,
  guard: TaskStartRunGuard,
  deps: TaskStartMoveDeps
): Promise<TaskStartResult> {
  const recorded = (cardMoves.get(cardKey) ?? Promise.resolve())
    .then(() => deps.moveCard(ref, DEFAULT_WORKSPACE_STATUS_ID, guard.alive))
    .catch((error: unknown) => {
      console.warn('[task-start] moving the started card failed', error)
      return 'skipped' as const
    })
    .then((moved) => recordCardMove(moved, cardKey, guard, deps))
    .catch((error: unknown) => {
      console.warn('[task-start] recording the started card move failed', error)
      return null
    })
  cardMoves.set(cardKey, recorded)
  void recorded.then(() => {
    if (cardMoves.get(cardKey) === recorded) {
      cardMoves.delete(cardKey)
    }
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deps.moveWaitMs ?? MOVE_WAIT_MS)
  })
  const run = await Promise.race([recorded, bound]).finally(() => clearTimeout(timer))
  return run ? { ok: true, run: summarizeTaskStartRun(run) } : started
}

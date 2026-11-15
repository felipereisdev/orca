import type { TaskStartPhaseResult } from '../../shared/task-board/task-board-wire-types'
import {
  getOptionalNonNegativeIntegerFlag,
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../arguments/flags'
import type { CommandHandler } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'

function formatPhase({ run, applied }: TaskStartPhaseResult): string {
  if (!applied) {
    return `Not recorded: the run is ${run.state}.`
  }
  const progress = run.progress ? ` ${run.progress.current}/${run.progress.total}` : ''
  const state = run.state === 'waiting' ? ' (waiting on the user)' : ''
  return `Task stage: ${run.phase}${progress}${state}, ${run.percent}%`
}

export const TASK_START_HANDLERS: Record<string, CommandHandler> = {
  // `orchestration.` carries the session's identity, so the host finds the caller's run.
  'task-start phase': async ({ flags, client, json }) => {
    const current = getOptionalNonNegativeIntegerFlag(flags, 'current')
    const total = getOptionalPositiveIntegerFlag(flags, 'total')
    const step = getOptionalStringFlag(flags, 'step')
    const note = getOptionalStringFlag(flags, 'note')
    const response = await client.call<TaskStartPhaseResult>('orchestration.taskStartPhase', {
      phase: getRequiredStringFlag(flags, 'phase'),
      ...(current !== undefined ? { current } : {}),
      ...(total !== undefined ? { total } : {}),
      ...(step ? { step } : {}),
      ...(note ? { note } : {})
    })
    printResult(response, json, formatPhase)
  }
}

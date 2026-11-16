import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

export const TASK_START_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['task-start', 'phase'],
    summary: "Report the stage of a task started from the board's play button",
    usage:
      'orca task-start phase <planning|plan-review|qa-script|development|final-review|qa|waiting|completed> [--current <n> --total <m> [--step implementing|reviewing]] [--note <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'phase', 'current', 'total', 'step', 'note'],
    positionalArgs: ['phase'],
    notes: [
      "Only the task's orchestrator can report: Orca knows the run from the chat or terminal the command runs in, so no id is passed. From any other session it fails with not_task_orchestrator.",
      '--current/--total (and --step) count subtasks and apply only to development.',
      'waiting marks the card "Waiting on you" and notifies the user; the next stage you report clears it. completed ends the run.'
    ],
    examples: [
      'orca task-start phase planning',
      'orca task-start phase development --current 3 --total 7 --step reviewing',
      'orca task-start phase waiting --note "Which database should the migration target?"',
      'orca task-start phase completed --json'
    ]
  }
]

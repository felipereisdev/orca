import { isTaskProvider, resolveVisibleTaskProvider, type TaskProvider } from './task-providers'
export type { TaskProvider }

export const ORCA_TASK_SOURCE = 'orca' as const

// Why: 'orca' is the unified board, not an external provider, so it stays out of TaskProvider.
export type TaskSource = TaskProvider | typeof ORCA_TASK_SOURCE

export function isOrcaTaskSource(value: unknown): value is typeof ORCA_TASK_SOURCE {
  return value === ORCA_TASK_SOURCE
}

export function isTaskSource(value: unknown): value is TaskSource {
  return isOrcaTaskSource(value) || isTaskProvider(value)
}

export function isTaskSourceVisible(
  source: TaskSource,
  visibleProviders: readonly TaskProvider[]
): boolean {
  // Why: the board is not a provider, so the visible-provider list never hides it.
  return isOrcaTaskSource(source) || visibleProviders.includes(source)
}

/** The board is always shown; a provider falls back to a visible one. */
export function resolveVisibleTaskSource(
  preferred: TaskSource | null | undefined,
  visibleProviders: readonly TaskProvider[]
): TaskSource {
  return isOrcaTaskSource(preferred)
    ? preferred
    : resolveVisibleTaskProvider(preferred, visibleProviders)
}

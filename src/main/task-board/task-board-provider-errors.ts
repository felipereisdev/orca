import { classifyGitHubUnavailable } from '../../shared/github/api/api-availability'
import type {
  TaskBoardProviderError,
  TaskBoardProviderResult
} from '../../shared/task-board/task-board-provider-results'
import type { TaskProvider } from '../../shared/work-items/task-providers'

const AUTH_FAILURE_PATTERN =
  /\b401\b|unauthori[sz]ed|not logged in|auth login|authentication (?:failed|required)/i

export function taskBoardErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Clients localize `code`; only unmistakable credential or transport failures get a specific one. */
export function classifyTaskBoardErrorMessage(message: string): TaskBoardProviderError['code'] {
  if (AUTH_FAILURE_PATTERN.test(message)) {
    return 'auth'
  }
  return classifyGitHubUnavailable(message) ? 'unavailable' : 'unknown'
}

export function failedTaskBoardProvider(
  provider: TaskProvider,
  error: TaskBoardProviderError
): TaskBoardProviderResult {
  return { provider, status: 'error', cards: [], error }
}

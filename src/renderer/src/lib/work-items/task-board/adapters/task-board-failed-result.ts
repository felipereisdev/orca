import { translate } from '@/i18n/i18n'
import { readIpcErrorDetail } from '@/runtime/errors/ipc-error'
import type {
  TaskBoardProviderError,
  TaskBoardProviderResult
} from '../../../../../../shared/task-board/task-board-provider-results'
import type { TaskProvider } from '../../../../../../shared/work-items/task-providers'

export function failedTaskBoardResult(
  provider: TaskProvider,
  error: unknown,
  code: TaskBoardProviderError['code'] = 'unknown'
): TaskBoardProviderResult {
  return {
    provider,
    status: 'error',
    cards: [],
    error: {
      code,
      message:
        (typeof error === 'string' ? error : readIpcErrorDetail(error)) ??
        translate('taskBoard.loadFailed', 'Could not load issues. Refresh to try again.')
    }
  }
}

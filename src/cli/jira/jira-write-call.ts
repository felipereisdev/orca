import type { HandlerContext } from '../dispatch/dispatch'
import {
  RuntimeClientError,
  RuntimeRpcFailureError,
  type RuntimeRpcSuccess
} from '../runtime/types'

export function jiraWriteFailure(failure: {
  code?: string
  errorCode?: string
  status?: unknown
  error?: string
  message?: string
}): RuntimeClientError {
  const code = failure.errorCode ?? failure.code
  const message = failure.error ?? failure.message ?? ''
  const classified = [
    'jira_permission_denied',
    'jira_issue_not_found',
    'jira_not_connected',
    'jira.notConnected',
    'jira_write_unverified'
  ].includes(code ?? '')
  if (
    code === 'jira_permission_denied' ||
    (!classified && (failure.status === 403 || /\b(?:HTTP|Error)\s*403\b/i.test(message)))
  ) {
    return new RuntimeClientError(
      'jira_permission_denied',
      'Jira denied the change. Check issue permissions in Orca Tasks before retrying.'
    )
  }
  if (
    code === 'jira_issue_not_found' ||
    (!classified && (failure.status === 404 || /\b(?:HTTP|Error)\s*404\b/i.test(message)))
  ) {
    return new RuntimeClientError(
      'jira_issue_not_found',
      'Jira did not expose this issue. Check the key and --site; Jira can hide inaccessible issues with HTTP 404.'
    )
  }
  if (
    code === 'jira_not_connected' ||
    code === 'jira.notConnected' ||
    (!classified && (failure.status === 401 || /\b(?:HTTP|Error)\s*401\b/i.test(message)))
  ) {
    return new RuntimeClientError(
      'jira_not_connected',
      'Reconnect Jira in Orca Tasks on the execution host before retrying.'
    )
  }
  return new RuntimeClientError(
    code === 'jira_write_unverified' ? code : 'jira_write_failed',
    'Jira did not confirm the change. Verify in Jira before retrying.'
  )
}

export async function callJiraWrite<T>(
  context: HandlerContext,
  method: string,
  params: unknown,
  sanitizeUnknown = false
): Promise<RuntimeRpcSuccess<T>> {
  try {
    return await context.client.call<T>(method, params)
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      if (
        [
          'runtime_timeout',
          'runtime_connection_failed',
          'runtime_disconnected',
          'runtime_unavailable'
        ].includes(error.code)
      ) {
        throw new RuntimeClientError(
          'jira_write_unverified',
          'The Jira change may have been applied. Verify in Jira before retrying.'
        )
      }
      if (
        error.code.startsWith('jira') ||
        error.code === 'runtime_error' ||
        (error instanceof RuntimeRpcFailureError &&
          !/^(runtime_|remote_runtime_|incompatible_runtime|invalid_argument|method_not_found)/.test(
            error.code
          ))
      ) {
        throw jiraWriteFailure(error)
      }
      if (
        sanitizeUnknown &&
        !/^(runtime_|remote_runtime_|incompatible_runtime|invalid_argument|method_not_found)/.test(
          error.code
        )
      ) {
        throw jiraWriteFailure(error)
      }
      throw error
    }
    if (sanitizeUnknown) {
      throw jiraWriteFailure({})
    }
    throw error
  }
}

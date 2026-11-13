import { expect, it } from 'vitest'
import { mapRuntimeError } from '../runtime/rpc/responses/rpc-response'
import { jiraAgentError, sanitizeJiraAgentError } from './jira-agent-request'

it('preserves sanitized Jira domain codes through the real RPC error mapper', () => {
  const error = sanitizeJiraAgentError({ status: 403, message: 'secret provider body' })
  expect(mapRuntimeError('request', { runtimeId: 'runtime' }, error)).toEqual({
    id: 'request',
    ok: false,
    _meta: { runtimeId: 'runtime' },
    error: {
      code: 'jira_permission_denied',
      message: 'jira_permission_denied: Jira denied access to this resource.'
    }
  })
  expect(
    mapRuntimeError(
      'request',
      { runtimeId: 'runtime' },
      jiraAgentError('jira_current_ambiguous', 'Select a workspace.')
    ).error.code
  ).toBe('jira_current_ambiguous')
})

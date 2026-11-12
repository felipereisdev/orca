import type { HandlerContext } from './dispatch'
import { RuntimeClientError, type RuntimeRpcSuccess } from './runtime-client'

export async function callJiraRead<T>(
  context: HandlerContext,
  method: string,
  params?: unknown
): Promise<RuntimeRpcSuccess<T>> {
  try {
    return await context.client.call<T>(method, params)
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      if (error.code === 'method_not_found') {
        throw new RuntimeClientError(
          'incompatible_runtime',
          'Update Orca on the execution host to use this Jira command.'
        )
      }
      if (/^(runtime_|remote_runtime_|incompatible_runtime)/.test(error.code)) {
        throw error
      }
      if (error.code === 'jira_issue_not_found') {
        throw new RuntimeClientError(
          error.code,
          'Jira did not expose this issue. Check the key and --site; Jira can hide inaccessible issues with HTTP 404.'
        )
      }
      if (error.code === 'jira_permission_denied') {
        throw new RuntimeClientError(
          error.code,
          'Jira denied access. Ask the site administrator for issue/project access, then retry.'
        )
      }
      if (error.code === 'jira_not_connected') {
        throw new RuntimeClientError(
          error.code,
          'Jira is not connected. Reconnect Jira in Orca Tasks on the execution host.'
        )
      }
      const recoveries: Record<string, string> = {
        jira_current_ambiguous:
          'Multiple Jira issues are linked to this workspace. Pass an explicit issue key or URL.',
        jira_no_linked_issue:
          'No Jira issue is linked to this workspace. Use worktree set --jira-issue or pass an explicit key.',
        jira_issue_required:
          'Could not verify the current workspace. Pass an explicit Jira issue key or URL.',
        jira_attachment_too_large:
          'The attachment exceeds the 20 MiB download limit. Download it in Jira.',
        jira_attachment_size_mismatch:
          'The attachment changed during download. Reload the issue and retry.',
        jira_invalid_offset: 'The attachment transfer is invalid. Reload the issue and retry.'
      }
      if (recoveries[error.code]) {
        throw new RuntimeClientError(error.code, recoveries[error.code])
      }
      // Legacy Jira RPCs expose HTTP status in their message; never echo the provider body.
      if (/\b403\b/.test(error.message)) {
        throw new RuntimeClientError(
          'jira_permission_denied',
          'Jira denied access. Ask the site administrator for issue/project access, then retry.'
        )
      }
      if (/\b404\b/.test(error.message)) {
        throw new RuntimeClientError(
          'jira_issue_not_found',
          'Jira did not expose this issue. Check the key and --site; Jira can hide inaccessible issues with HTTP 404.'
        )
      }
    }
    throw new RuntimeClientError(
      'jira_read_failed',
      'Could not read Jira data. Check the connection in Orca Tasks and retry.'
    )
  }
}

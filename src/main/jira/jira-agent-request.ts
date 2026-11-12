import type { JiraAgentErrorCode } from '../../shared/jira/jira-agent-access'
import { getClients } from './client'
import { apiBasePath, jiraRequest, type JiraClientForSite } from './authenticated-request'
import { acquire, release } from './request-queue'
import type { JiraRecord } from './jira-record-pages'

export class JiraAgentAccessError extends Error {
  constructor(
    readonly code: JiraAgentErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`)
    this.name = 'JiraAgentAccessError'
  }
}
export function jiraAgentError(code: JiraAgentErrorCode, message: string): JiraAgentAccessError {
  return new JiraAgentAccessError(code, message)
}
export function sanitizeJiraAgentError(error: unknown): Error {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null
  if (status === 401) {
    return jiraAgentError('jira_not_connected', 'Connect Jira in Tasks and try again.')
  }
  if (status === 403) {
    return jiraAgentError('jira_permission_denied', 'Jira denied access to this resource.')
  }
  if (status === 404) {
    return jiraAgentError(
      'jira_issue_not_found',
      'Issue or attachment not found. Jira may conceal inaccessible issues with 404.'
    )
  }
  return jiraAgentError(
    'jira_read_failed',
    'Unable to read Jira. Check the connection in Tasks and try again.'
  )
}
export function jiraAgentClient(siteId: string): JiraClientForSite {
  let client: JiraClientForSite | undefined
  try {
    client = getClients(siteId).find((entry) => entry.site.id === siteId)
  } catch {
    /* Credential failures are sanitized. */
  }
  if (!client) {
    throw jiraAgentError('jira_not_connected', 'Connect this Jira site in Tasks and try again.')
  }
  return client
}
export async function jiraAgentRequest(
  client: JiraClientForSite,
  path: string,
  signal?: AbortSignal,
  init?: RequestInit
): Promise<JiraRecord> {
  await acquire(signal)
  try {
    return await jiraRequest<JiraRecord>(client, path, { ...init, signal }, 4 * 1024 * 1024)
  } catch (error) {
    throw sanitizeJiraAgentError(error)
  } finally {
    release()
  }
}
export function jiraAgentIssuePath(
  client: JiraClientForSite,
  key: string,
  fields: string[]
): string {
  return `${apiBasePath(client.site)}/issue/${encodeURIComponent(key)}?${new URLSearchParams({ fields: fields.join(','), expand: 'renderedFields' })}`
}

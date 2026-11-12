import { apiBasePath, jiraRequest, type JiraClientForSite } from './authenticated-request'
import { clearToken, getClients, isAuthError } from './client'
import { getErrorStatus } from './jira-read-failure'
import { acquire, release } from './request-queue'

export async function addRemoteLink(args: {
  key: string
  siteId: string
  url: string
  title?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string; errorCode?: string }> {
  let url: URL
  try {
    url = new URL(args.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Invalid remote link URL.')
    }
  } catch {
    return { ok: false, error: 'Remote links require an HTTP(S) URL without credentials.' }
  }
  let entry: JiraClientForSite | undefined
  try {
    const entries = getClients(args.siteId)
    entry = entries.length === 1 && entries[0].site.id === args.siteId ? entries[0] : undefined
  } catch {
    return {
      ok: false,
      errorCode: 'jira_not_connected',
      error: 'Jira credentials are unavailable. Reconnect Jira in Orca Tasks.'
    }
  }
  if (!entry) {
    return {
      ok: false,
      errorCode: 'jira_not_connected',
      error: 'Select one connected Jira site. Connect through Orca Tasks.'
    }
  }
  await acquire()
  try {
    const link = await jiraRequest<{ id: string | number }>(
      entry,
      `${apiBasePath(entry.site)}/issue/${encodeURIComponent(args.key)}/remotelink`,
      {
        method: 'POST',
        body: JSON.stringify({ object: { url: url.href, title: args.title?.trim() || url.href } })
      }
    )
    return { ok: true, id: String(link.id) }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(entry.site.id)
    }
    const status = getErrorStatus(error)
    return {
      ok: false,
      ...(status === 401
        ? { errorCode: 'jira_not_connected' }
        : status === 403
          ? { errorCode: 'jira_permission_denied' }
          : status === 404
            ? { errorCode: 'jira_issue_not_found' }
            : {}),
      error:
        status === 401 || status === 403
          ? 'Jira denied the remote link. Check the connection and issue permissions in Tasks.'
          : status === 404
            ? 'Jira issue was not found or is inaccessible.'
            : 'Jira did not confirm the remote link. Verify in Jira before retrying.'
    }
  } finally {
    release()
  }
}

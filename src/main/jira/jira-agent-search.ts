import { boundJiraAgentOutput } from '../../shared/jira/jira-agent-access'
import { sortByUpdatedAtDescending } from '../../shared/updated-at-order'
import type {
  JiraAgentSearchIssuesParams,
  JiraAgentSearchIssuesResult
} from '../../shared/jira/jira-agent-access'
import { buildJiraPresetJql } from '../../shared/jira/jira-preset-jql'
import { agileFieldIdList, getAgileFieldIds } from './jira-agile-fields'
import { apiBasePath } from './authenticated-request'
import { ISSUE_LIST_FIELDS, mapJiraIssue } from './jira-issue-mapping'
import { jiraAgentClient, jiraAgentError, jiraAgentRequest } from './jira-agent-request'
import { asString, asRecord } from './jira-record-pages'

export async function jiraAgentSearchIssues(
  params: JiraAgentSearchIssuesParams,
  signal?: AbortSignal
): Promise<JiraAgentSearchIssuesResult> {
  const client = jiraAgentClient(params.siteId)
  if (params.filter === 'all' && !params.jql && client.site.authType !== 'server') {
    const ids: string[] = []
    let complete = false
    for (let page = 0; page < 10; page++) {
      const result = await jiraAgentRequest(
        client,
        `/rest/api/3/project/search?startAt=${ids.length}&maxResults=100`,
        signal
      )
      if (!Array.isArray(result.values)) {
        throw jiraAgentError('jira_read_failed', 'Jira returned an invalid project page.')
      }
      const values = result.values.slice(0, 100)
      for (const value of values) {
        const project = asRecord(value)
        const id = asString(project.id) || asString(project.key)
        if (!id || id.length > 128) {
          throw jiraAgentError('jira_read_failed', 'Jira returned an invalid project identity.')
        }
        ids.push(id)
      }
      if (
        result.isLast === true ||
        (typeof result.total === 'number' && ids.length >= result.total)
      ) {
        complete = true
        break
      }
      if (!values.length) {
        throw jiraAgentError('jira_read_failed', 'Jira returned an incomplete project page.')
      }
    }
    if (!complete) {
      throw jiraAgentError('jira_read_failed', 'Too many Jira projects. Select a project with JQL.')
    }
    let merged: JiraAgentSearchIssuesResult = { issues: [], truncated: false }
    for (let start = 0; start < ids.length; start += 100) {
      const result = await jiraAgentSearchIssues(
        {
          siteId: params.siteId,
          limit: params.limit,
          jql: `project in (${ids
            .slice(start, start + 100)
            .map((id) => JSON.stringify(id))
            .join(', ')}) AND ${buildJiraPresetJql('all')}`
        },
        signal
      )
      const issues = sortByUpdatedAtDescending([...merged.issues, ...result.issues])
      const bounded = boundJiraAgentOutput(issues.slice(0, Math.min(50, params.limit)))
      merged = {
        issues: bounded.issues,
        truncated:
          merged.truncated || result.truncated || bounded.truncated || issues.length > params.limit
      }
    }
    return merged
  }
  const agile = await getAgileFieldIds(client, signal)
  const limit = Math.min(
    50,
    Math.max(1, Number.isFinite(params.limit) ? Math.floor(params.limit) : 20)
  )
  const issues: JiraAgentSearchIssuesResult['issues'] = []
  const seen = new Set<string>()
  let token: string | undefined
  let startAt = 0
  let truncated = false
  const server = client.site.authType === 'server'
  for (let pageIndex = 0; pageIndex < 51; pageIndex++) {
    const requested = limit + 1 - issues.length
    const response = await jiraAgentRequest(
      client,
      server ? `${apiBasePath(client.site)}/search` : '/rest/api/3/search/jql',
      signal,
      {
        method: 'POST',
        body: JSON.stringify({
          jql: params.jql?.trim() || buildJiraPresetJql(params.filter ?? 'assigned'),
          maxResults: requested,
          fields: [...ISSUE_LIST_FIELDS, ...agileFieldIdList(agile)],
          ...(server ? { startAt } : token ? { nextPageToken: token } : {})
        })
      }
    )
    if (!Array.isArray(response.issues)) {
      throw jiraAgentError('jira_read_failed', 'Jira returned an invalid search page.')
    }
    const raw = response.issues
    const selected = raw.slice(0, requested)
    for (const value of selected) {
      const issue = mapJiraIssue(client.site, asRecord(value), undefined, agile)
      if (
        issue.id.length > 512 ||
        issue.key.length > 128 ||
        issue.url.length > 4096 ||
        issue.createdAt.length > 128 ||
        issue.updatedAt.length > 128
      ) {
        throw jiraAgentError('jira_read_failed', 'Jira returned an invalid issue identity.')
      }
      const bounded = boundJiraAgentOutput([issue])
      const item = bounded.issues[0]
      if (!item) {
        throw jiraAgentError('jira_read_failed', 'Jira returned oversized issue metadata.')
      }
      truncated ||= bounded.truncated
      issues.push(item)
    }
    startAt += selected.length
    const nextToken = asString(response.nextPageToken)
    const more = server
      ? typeof response.total === 'number'
        ? startAt < response.total
        : response.isLast === false || raw.length >= requested
      : response.isLast === false || Boolean(nextToken)
    if (raw.length > requested || issues.length > limit || (issues.length === limit && more)) {
      truncated = true
      break
    }
    if (response.isLast === true || !more) {
      break
    }
    if (selected.length === 0 || (!server && (!nextToken || seen.has(nextToken)))) {
      throw jiraAgentError('jira_read_failed', 'Jira returned an incomplete search page.')
    }
    if (nextToken) {
      seen.add(nextToken)
      token = nextToken
    }
    if (pageIndex === 50) {
      truncated = true
    }
  }
  const bounded = boundJiraAgentOutput(issues.slice(0, limit))
  return { issues: bounded.issues, truncated: truncated || bounded.truncated }
}

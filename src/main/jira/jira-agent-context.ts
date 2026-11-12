import type {
  JiraAgentAttachment,
  JiraAgentIssueRef,
  JiraIssueContextParams,
  JiraIssueContextResult
} from '../../shared/jira/jira-agent-access'
import { adfToMarkdownText } from './adf-markdown'
import { jiraAgentMarkdownOptions } from './jira-agent-media'
import { apiBasePath } from './authenticated-request'
import { agileFieldIdList, getAgileFieldIds } from './jira-agile-fields'
import { ISSUE_DETAIL_FIELDS, issueUrl, mapJiraIssue, mapUser } from './jira-issue-mapping'
import { asRecord, asString } from './jira-record-pages'
import {
  jiraAgentClient,
  jiraAgentError,
  jiraAgentIssuePath,
  jiraAgentRequest,
  sanitizeJiraAgentError
} from './jira-agent-request'

export function jiraAgentAttachments(value: unknown): JiraAgentAttachment[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const raw = asRecord(item)
      return {
        id: asString(raw.id),
        filename: asString(raw.filename),
        mimeType: asString(raw.mimeType),
        size: typeof raw.size === 'number' ? raw.size : 0
      }
    })
    .filter((item) => item.id !== '')
}
export async function jiraIssueContext(
  params: JiraIssueContextParams,
  signal?: AbortSignal
): Promise<JiraIssueContextResult> {
  const client = jiraAgentClient(params.siteId)
  let agile
  try {
    agile = await getAgileFieldIds(client, signal)
  } catch (error) {
    throw sanitizeJiraAgentError(error)
  }
  const raw = await jiraAgentRequest(
    client,
    jiraAgentIssuePath(client, params.key, [
      ...ISSUE_DETAIL_FIELDS,
      ...agileFieldIdList(agile),
      ...(params.links ? ['issuelinks'] : []),
      ...(params.subtasks ? ['subtasks'] : [])
    ]),
    signal
  )
  const fields = asRecord(raw.fields)
  const attachments = jiraAgentAttachments(fields.attachment)
  const options = jiraAgentMarkdownOptions(
    fields.description,
    asString(asRecord(raw.renderedFields).description),
    attachments,
    client.site.siteUrl
  )
  const issue = mapJiraIssue(client.site, raw, options, agile)
  let budget = 100_000
  let truncated = false
  const bound = (text: string, cap = 20_000): string => {
    const length = Math.min(cap, budget)
    const result = text.slice(0, length)
    budget -= result.length
    if (result.length < text.length) {
      truncated = true
    }
    return result
  }
  const take = <T>(items: T[], cap: number): T[] => {
    if (items.length > cap) {
      truncated = true
    }
    return items.slice(0, cap)
  }
  const ref = (value: unknown): JiraAgentIssueRef => {
    const item = asRecord(value)
    const key = asString(item.key)
    return {
      id: bound(asString(item.id), 1000),
      key: bound(key, 1000),
      title: bound(asString(asRecord(item.fields).summary)),
      url: issueUrl(client.site, key)
    }
  }
  const result: JiraIssueContextResult = {
    ...issue,
    title: bound(issue.title),
    summary: '',
    description: bound(issue.description ?? ''),
    truncated: false
  }
  result.summary = result.title
  if (params.attachments) {
    result.attachments = take(attachments, 100).map((item) => ({
      ...item,
      filename: bound(item.filename, 1000),
      mimeType: bound(item.mimeType, 200)
    }))
  }
  if (params.subtasks) {
    result.subtasks = take(Array.isArray(fields.subtasks) ? fields.subtasks : [], 100).map(ref)
  }
  if (params.links) {
    result.links = take(Array.isArray(fields.issuelinks) ? fields.issuelinks : [], 100).map(
      (value) => {
        const link = asRecord(value)
        return {
          ...ref(link.outwardIssue ?? link.inwardIssue),
          relationship: bound(
            asString(asRecord(link.type)[link.outwardIssue ? 'outward' : 'inward']),
            1000
          )
        }
      }
    )
  }
  if (params.comments) {
    result.comments = []
    if (budget <= 0) {
      truncated = true
    }
    let start = 0
    while (start < 500 && budget > 0) {
      const page = await jiraAgentRequest(
        client,
        `${apiBasePath(client.site)}/issue/${encodeURIComponent(params.key)}/comment?${new URLSearchParams({ startAt: String(start), maxResults: String(Math.min(50, 500 - start)), orderBy: 'created', expand: 'renderedBody' })}`,
        signal
      )
      if (!Array.isArray(page.comments)) {
        throw jiraAgentError('jira_read_failed', 'Jira returned an invalid comment page.')
      }
      const comments = page.comments
      if (
        comments.length === 0 &&
        (page.isLast === false || (typeof page.total === 'number' && start < page.total))
      ) {
        throw jiraAgentError('jira_read_failed', 'Jira returned an incomplete comment page.')
      }
      const selected = take(comments, Math.min(50, 500 - start))
      for (const value of selected) {
        const comment = asRecord(value)
        const user = mapUser(comment.author)
        if (user) {
          user.accountId = bound(user.accountId, 1000)
          user.displayName = bound(user.displayName, 1000)
          user.email = user.email ? bound(user.email, 1000) : user.email
          user.avatarUrl = user.avatarUrl ? bound(user.avatarUrl, 2000) : undefined
        }
        result.comments.push({
          id: bound(asString(comment.id), 1000),
          body: bound(
            adfToMarkdownText(
              comment.body,
              jiraAgentMarkdownOptions(
                comment.body,
                asString(comment.renderedBody),
                attachments,
                client.site.siteUrl
              )
            )
          ),
          createdAt: bound(asString(comment.created), 100),
          updatedAt: bound(asString(comment.updated), 100) || undefined,
          user
        })
      }
      start += selected.length
      if (
        page.isLast === true ||
        (typeof page.total === 'number' && start >= page.total) ||
        selected.length === 0
      ) {
        break
      }
      if (start >= 500 || budget <= 0) {
        truncated = true
        break
      }
    }
  }
  let remaining = 100_000
  const boundOutput = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const text = value.slice(0, Math.min(20_000, remaining))
      remaining -= text.length
      if (text.length < value.length) {
        truncated = true
      }
      return text
    }
    if (Array.isArray(value)) {
      return value.map(boundOutput)
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, boundOutput(item)])
      )
    }
    return value
  }
  result.labels = take(result.labels, 100)
  const { id, key, siteId, url, createdAt, updatedAt, status, summary, title, ...rest } = result
  const bounded = {
    id,
    key,
    siteId,
    url,
    createdAt,
    updatedAt,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only string leaves are shortened; every field and its type is retained.
    ...(boundOutput({ status, summary, title, ...rest }) as Omit<
      JiraIssueContextResult,
      'id' | 'key' | 'siteId' | 'url' | 'createdAt' | 'updatedAt'
    >)
  }
  bounded.truncated = truncated
  return bounded
}

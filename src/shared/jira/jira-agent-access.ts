import type { JiraComment, JiraIssue, JiraIssueFilter } from './jira-types'

export type JiraIssueContextParams = {
  key: string
  siteId: string
  comments?: boolean
  attachments?: boolean
  links?: boolean
  subtasks?: boolean
}
export type JiraAgentAttachment = { id: string; filename: string; mimeType: string; size: number }
export type JiraAgentIssueRef = { id: string; key: string; title: string; url: string }
export type JiraAgentLink = JiraAgentIssueRef & { relationship: string }
export type JiraIssueContextResult = JiraIssue & {
  summary: string
  comments?: JiraComment[]
  attachments?: JiraAgentAttachment[]
  links?: JiraAgentLink[]
  subtasks?: JiraAgentIssueRef[]
  truncated: boolean
}
export type JiraAttachmentReadParams = { key: string; siteId: string; id: string; offset: number }
export type JiraAttachmentReadResult = JiraAgentAttachment & {
  content: string
  offset: number
  nextOffset: number | null
}
export const JIRA_AGENT_ATTACHMENT_CHUNK_BYTES = 256 * 1024
export const JIRA_AGENT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

export type JiraAgentSearchIssuesParams = {
  siteId: string
  jql?: string
  filter?: JiraIssueFilter
  limit: number
}
export type JiraAgentSearchIssuesResult = { issues: JiraIssue[]; truncated: boolean }
export const JIRA_AGENT_ERROR_CODES = [
  'jira_not_connected',
  'jira_issue_not_found',
  'jira_permission_denied',
  'jira_read_failed',
  'jira_invalid_offset',
  'jira_attachment_too_large',
  'jira_attachment_size_mismatch',
  'jira_current_ambiguous',
  'jira_no_linked_issue',
  'jira_issue_required'
] as const
export type JiraAgentErrorCode = (typeof JIRA_AGENT_ERROR_CODES)[number]

export function boundJiraAgentOutput(input: JiraIssue[]): JiraAgentSearchIssuesResult {
  let truncated = input.length > 50
  const identity = new Set(['id', 'key', 'siteId', 'url', 'createdAt', 'updatedAt', 'status'])
  const shape = (value: unknown, empty: boolean, root = false): unknown => {
    if (typeof value === 'string') {
      return empty ? '' : value
    }
    if (Array.isArray(value)) {
      if (value.length > 100) {
        truncated = true
      }
      return value.slice(0, 100).map((item) => shape(item, empty))
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          root && identity.has(key) ? item : shape(item, empty)
        ])
      )
    }
    return value
  }
  const statusText = (value: string): string => {
    if (value.length > 256) {
      truncated = true
    }
    return value.slice(0, 256)
  }
  let issues = input.slice(0, 50).map((issue) => {
    const prepared: JiraIssue = {
      ...issue,
      status: {
        id: statusText(issue.status.id),
        name: statusText(issue.status.name),
        categoryKey: statusText(issue.status.categoryKey),
        categoryName: statusText(issue.status.categoryName),
        colorName:
          issue.status.colorName === undefined ? undefined : statusText(issue.status.colorName)
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Shape retains every JiraIssue field and leaf type, shortening only strings and arrays.
    return shape(prepared, false, true) as JiraIssue
  })
  let overhead = JSON.stringify({
    issues: issues.map((issue) => shape(issue, true, true)),
    truncated: false
  }).length
  while (overhead > 100_000 && issues.length) {
    issues.pop()
    truncated = true
    overhead = JSON.stringify({
      issues: issues.map((issue) => shape(issue, true, true)),
      truncated: false
    }).length
  }
  let remaining = 100_000 - overhead
  const bound = (value: unknown, root = false): unknown => {
    if (typeof value === 'string') {
      let low = 0
      let high = Math.min(value.length, 20_000)
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (JSON.stringify(value.slice(0, middle)).length - 2 <= remaining) {
          low = middle
        } else {
          high = middle - 1
        }
      }
      const text = value.slice(0, low)
      remaining -= JSON.stringify(text).length - 2
      if (text.length < value.length) {
        truncated = true
      }
      return text
    }
    if (Array.isArray(value)) {
      return value.map((item) => bound(item))
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          root && identity.has(key) ? item : bound(item)
        ])
      )
    }
    return value
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Bound replaces only string leaves; identity, status, timestamps and all field types are preserved.
  issues = issues.map((issue) => bound(issue, true) as JiraIssue)
  return { issues, truncated }
}

import type { JiraIssue, JiraIssueFilter } from '../../shared/jira/jira-types'
import {
  boundJiraAgentOutput,
  type JiraAgentSearchIssuesResult
} from '../../shared/jira/jira-agent-access'
import { buildJiraPresetJql } from '../../shared/jira/jira-preset-jql'
import { restrictJiraQueryToProject } from '../../shared/jira/jira-project-reference'
import {
  buildJiraIssueKeyJql,
  buildJiraTextMatchJql,
  mayBeJql
} from '../../shared/jira/jira-search-input-jql'
import type { CommandHandler, HandlerContext } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { formatJiraIssueList } from '../jira-format'
import { callJiraRead } from '../jira-read-call'
import { connectedJiraSites, resolveJiraTarget } from '../jira-target'
import { RuntimeClientError } from '../runtime-client'

function projectQuery(context: HandlerContext, jql: string): string {
  const project = getOptionalStringFlag(context.flags, 'project')?.trim()
  if (!project) {
    return jql
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(project)) {
    throw new RuntimeClientError('invalid_argument', '--project must be a Jira project key.')
  }
  return restrictJiraQueryToProject(jql, {
    id: project.toUpperCase(),
    key: project.toUpperCase(),
    name: project,
    siteId: ''
  })
}

async function listQuery(
  context: HandlerContext,
  jql?: string,
  filter?: JiraIssueFilter
): Promise<void> {
  const limit = Math.min(getOptionalPositiveIntegerFlag(context.flags, 'limit') ?? 20, 50)
  const sites =
    getOptionalStringFlag(context.flags, 'site') === 'all'
      ? await connectedJiraSites(context)
      : [(await resolveJiraTarget(context)).site]
  const rows: JiraIssue[] = []
  let envelope
  let truncated = false
  // A failure on any site fails the command rather than claiming a complete fan-out.
  for (const site of sites) {
    const response = await callJiraRead<JiraAgentSearchIssuesResult>(
      context,
      'jira.agentSearchIssues',
      {
        jql,
        ...(filter ? { filter } : {}),
        limit,
        siteId: site.id
      }
    )
    truncated ||= response.result.truncated
    rows.push(...response.result.issues)
    rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    if (rows.length > limit) {
      rows.length = limit
      truncated = true
    }
    envelope = response
  }
  rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  truncated ||= rows.length > limit
  const bounded = boundJiraAgentOutput(rows.slice(0, limit))
  const result = bounded.issues
  truncated ||= bounded.truncated
  // Keep the existing array result contract; expose collection truncation in the envelope.
  printResult(
    { ...envelope!, result, truncated, _meta: { ...envelope!._meta, truncated } },
    context.json,
    () =>
      formatJiraIssueList(result) +
      (truncated ? '\nResults truncated. Narrow --jql or --project.' : '')
  )
}

export const listJiraIssues: CommandHandler = async (context) => {
  const jql = getOptionalStringFlag(context.flags, 'jql')?.trim()
  const filter = getOptionalStringFlag(context.flags, 'filter')?.trim().toLowerCase()
  if (context.flags.has('jql') && (!jql || filter)) {
    throw new RuntimeClientError('invalid_argument', 'Pass nonempty --jql without --filter.')
  }
  if (filter && !['assigned', 'reported', 'open', 'all', 'done'].includes(filter)) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--filter must be assigned, reported, open or done.'
    )
  }
  if (!jql && !filter && !context.flags.has('project')) {
    return listQuery(context)
  }
  const preset = filter === 'open' ? 'all' : (filter ?? 'assigned')
  if (preset !== 'assigned' && preset !== 'reported' && preset !== 'all' && preset !== 'done') {
    throw new RuntimeClientError('invalid_argument', 'Unsupported Jira filter.')
  }
  if (!jql && !context.flags.has('project')) {
    return listQuery(context, undefined, preset)
  }
  return listQuery(context, projectQuery(context, jql ?? buildJiraPresetJql(preset)))
}

export const searchJiraIssues: CommandHandler = async (context) => {
  const input = getRequiredStringFlag(context.flags, 'jql').trim()
  const jql = mayBeJql(input)
    ? input
    : (buildJiraIssueKeyJql(input) ?? buildJiraTextMatchJql(input))
  if (!jql) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Search text must contain searchable words or a Jira issue key.'
    )
  }
  return listQuery(context, projectQuery(context, jql))
}

import type { JiraIssueContextResult } from '../../shared/jira/jira-agent-access'
import { isResolvedJiraIssueMatch, parseJiraIssueUrl } from '../../shared/jira/jira-issue-url'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { formatJiraCommentList, formatJiraIssue } from '../jira-format'
import { callJiraRead } from '../jira-read-call'
import { resolveJiraTarget } from '../jira-target'
import { buildLinearCurrentContext } from '../linear-request-builders'
import { RuntimeClientError } from '../runtime-client'

async function issueTarget(context: HandlerContext) {
  const input = getOptionalStringFlag(context.flags, 'key')
  const current = context.flags.get('current') === true
  if (current === Boolean(input)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Pass an issue key or URL, or --current, but not both.'
    )
  }
  if (!current) {
    return resolveJiraTarget(context, input!)
  }
  const { result: link } = await callJiraRead<{ key: string; url?: string; siteId?: string }>(
    context,
    'jira.currentIssue',
    buildLinearCurrentContext(context.cwd, context.client.isRemote)
  )
  const explicitSite = getOptionalStringFlag(context.flags, 'site')
  if (explicitSite && link.siteId && explicitSite !== link.siteId) {
    throw new RuntimeClientError(
      'jira_issue_not_found',
      'The linked issue belongs to a different Jira site. Omit --site or use its linked site.'
    )
  }
  const linkedContext = { ...context, flags: new Map(context.flags) }
  if (!explicitSite && link.siteId) {
    linkedContext.flags.set('site', link.siteId)
  }
  return resolveJiraTarget(linkedContext, link.url ?? link.key)
}

function formatIssueContext(issue: JiraIssueContextResult): string {
  const lines = [formatJiraIssue(issue)]
  if (issue.comments) {
    lines.push('', 'Comments:', formatJiraCommentList(issue.comments))
  }
  if (issue.attachments) {
    lines.push(
      '',
      'Attachments:',
      ...issue.attachments.map(
        (file) => `${file.id}\t${file.filename}\t${file.mimeType}\t${file.size} bytes`
      )
    )
  }
  if (issue.links) {
    lines.push(
      '',
      'Links:',
      ...issue.links.map((link) => `${link.relationship}\t${link.key}\t${link.title}\t${link.url}`)
    )
  }
  if (issue.subtasks) {
    lines.push(
      '',
      'Subtasks:',
      ...issue.subtasks.map((task) => `${task.key}\t${task.title}\t${task.url}`)
    )
  }
  if (issue.truncated) {
    lines.push('', 'Content truncated. Narrow the request or read the full issue in Jira.')
  }
  return lines.join('\n')
}

export const readJiraIssue: CommandHandler = async (context) => {
  const target = await issueTarget(context)
  const full = context.flags.get('full') === true
  const response = await callJiraRead<JiraIssueContextResult>(context, 'jira.issueContext', {
    key: target.key,
    siteId: target.siteId,
    comments: full || context.flags.get('comments') === true,
    attachments: full || context.flags.get('attachments') === true,
    links: full || context.flags.get('links') === true,
    subtasks: full || context.flags.get('subtasks') === true
  })
  const issue = response.result
  const parsed = parseJiraIssueUrl(issue?.url ?? '')
  if (
    !issue ||
    !parsed ||
    !isResolvedJiraIssueMatch(parsed, target.site, issue) ||
    issue.key.toUpperCase() !== target.key
  ) {
    throw new RuntimeClientError(
      'jira_issue_not_found',
      'Jira did not return this issue on the selected site. Check the key and --site.'
    )
  }
  printResult(response, context.json, formatIssueContext)
}

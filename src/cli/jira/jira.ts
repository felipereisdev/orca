import type {
  JiraConnectionStatus,
  JiraCreateField,
  JiraIssueType,
  JiraPriority,
  JiraProject,
  JiraTransition,
  JiraUser
} from '../../shared/jira/jira-types'
import type { JiraIssueContextResult } from '../../shared/jira/jira-agent-access'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import {
  formatJiraCommentList,
  formatJiraIssueTypeList,
  formatJiraPriorityList,
  formatJiraProjectList,
  formatJiraTransitionList,
  formatJiraUserList
} from './jira-format'
import { resolveJiraTarget } from './jira-target'
import { JIRA_WRITE_HANDLERS } from './jira-write'
import { readJiraIssue } from './jira-issue-read'
import { listJiraIssues, searchJiraIssues } from './jira-collection-read'
import { downloadJiraAttachments } from './jira-attachment-download'
import { callJiraRead } from './jira-read-call'
import { JIRA_LINK_WRITE_HANDLERS } from './jira-link-write'

function issueTarget(context: HandlerContext) {
  return resolveJiraTarget(context, getRequiredStringFlag(context.flags, 'key'))
}

export const JIRA_HANDLERS: Record<string, CommandHandler> = {
  ...JIRA_WRITE_HANDLERS,
  ...JIRA_LINK_WRITE_HANDLERS,
  'jira label remove': JIRA_WRITE_HANDLERS['jira label rm'],
  'jira connection': async (context) => {
    const response = await callJiraRead<JiraConnectionStatus>(context, 'jira.status')
    const status = {
      ...response.result,
      ...(response.result.credentialError
        ? { credentialError: 'Reconnect Jira in Orca Tasks on the execution host.' }
        : {})
    }
    printResult({ ...response, result: status }, context.json, (status) =>
      [
        ...(status.sites ?? []).map(
          (site) =>
            `${site.id}\t${site.siteUrl}${status.selectedSiteId === site.id ? '\t(selected)' : ''}`
        ),
        ...(status.credentialError ? ['Reconnect Jira in Orca Tasks on the execution host.'] : []),
        'Saved Orca Jira connections; this does not verify access or agent MCP authentication.'
      ].join('\n')
    )
  },
  'jira issue': readJiraIssue,
  'jira list': listJiraIssues,
  'jira search': searchJiraIssues,
  'jira attachment download': downloadJiraAttachments,
  'jira project list': async (context) => {
    const target = await resolveJiraTarget(context)
    const response = await callJiraRead<JiraProject[]>(context, 'jira.listProjects', {
      siteId: target.siteId,
      strict: true
    })
    printResult(response, context.json, formatJiraProjectList)
  },
  'jira project types': async (context) => {
    const projectIdOrKey = getRequiredStringFlag(context.flags, 'project')
    const target = await resolveJiraTarget(context)
    const response = await callJiraRead<JiraIssueType[]>(context, 'jira.listIssueTypes', {
      projectIdOrKey,
      siteId: target.siteId,
      strict: true
    })
    printResult(response, context.json, formatJiraIssueTypeList)
  },
  'jira project fields': async (context) => {
    const projectIdOrKey = getRequiredStringFlag(context.flags, 'project')
    const issueTypeId = getRequiredStringFlag(context.flags, 'type')
    const target = await resolveJiraTarget(context)
    const response = await callJiraRead<JiraCreateField[]>(context, 'jira.listCreateFields', {
      projectIdOrKey,
      issueTypeId,
      siteId: target.siteId,
      strict: true
    })
    printResult(
      response,
      context.json,
      (fields) =>
        fields
          .map(
            (field) => `${field.key}\t${field.name}\t${field.required ? 'required' : 'optional'}`
          )
          .join('\n') || 'No create fields.'
    )
  },
  'jira comment list': async (context) => {
    const target = await issueTarget(context)
    const response = await callJiraRead<JiraIssueContextResult>(context, 'jira.issueContext', {
      key: target.key,
      siteId: target.siteId,
      comments: true
    })
    const truncated = response.result.truncated
    const commentsResponse = {
      ...response,
      result: response.result.comments ?? [],
      truncated,
      _meta: { ...response._meta, truncated }
    }
    printResult(
      commentsResponse,
      context.json,
      (comments) =>
        formatJiraCommentList(comments) +
        (truncated ? '\nContent truncated. Read the full issue in Jira.' : '')
    )
  },
  'jira status list': async (context) => {
    const target = await issueTarget(context)
    const response = await callJiraRead<JiraTransition[]>(context, 'jira.listTransitions', {
      key: target.key,
      siteId: target.siteId,
      strict: true
    })
    printResult(response, context.json, formatJiraTransitionList)
  },
  'jira assignee list': async (context) => {
    const query = getOptionalStringFlag(context.flags, 'query')
    const target = await issueTarget(context)
    const response = await callJiraRead<JiraUser[]>(context, 'jira.listAssignableUsers', {
      key: target.key,
      query,
      siteId: target.siteId,
      strict: true
    })
    printResult(response, context.json, formatJiraUserList)
  },
  'jira priority list': async (context) => {
    const target = await resolveJiraTarget(context)
    const response = await callJiraRead<JiraPriority[]>(context, 'jira.listPriorities', {
      siteId: target.siteId,
      strict: true
    })
    printResult(response, context.json, formatJiraPriorityList)
  }
}

JIRA_HANDLERS['jira site list'] = JIRA_HANDLERS['jira connection']

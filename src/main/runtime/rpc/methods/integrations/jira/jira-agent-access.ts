import {
  AgentIssueContext,
  AgentAttachmentRead,
  AgentSearchIssues
} from '../../../../../../shared/rpc-contract/jira-agent-access-params'
import { defineMethod } from '../../../core'
import { jiraAgentSearchIssues } from '../../../../../jira/jira-agent-search'
import { jiraIssueContext } from '../../../../../jira/jira-agent-context'
import { jiraAttachmentRead } from '../../../../../jira/jira-agent-attachment'

export const JIRA_AGENT_ACCESS_METHODS = [
  defineMethod({
    name: 'jira.agentSearchIssues',
    permission: 'workspace',
    params: AgentSearchIssues,
    handler: (params, { signal }) => jiraAgentSearchIssues(params, signal)
  }),
  defineMethod({
    name: 'jira.issueContext',
    permission: 'workspace',
    params: AgentIssueContext,
    handler: (params, { signal }) => jiraIssueContext(params, signal)
  }),
  defineMethod({
    name: 'jira.attachmentRead',
    permission: 'workspace',
    params: AgentAttachmentRead,
    handler: (params, { signal }) => jiraAttachmentRead(params, signal)
  })
]

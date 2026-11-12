import { AgentCurrentIssue } from '../../../../../../shared/rpc-contract/jira-agent-access-params'
import { defineMethod } from '../../../core'
import { jiraAgentError } from '../../../../../jira/jira-agent-request'
import {
  getWorkspaceReferenceIdentifier,
  getWorkspaceReferenceIdentity
} from '../../../../../../shared/workspace-attachments/workspace-reference-identity'
import type { RuntimeReferenceListResult } from '../../../../../../shared/runtime-reference-contracts'
import { parseJiraIssueUrl } from '../../../../../../shared/jira/jira-issue-url'

export function currentJiraReference(result: RuntimeReferenceListResult) {
  const references = result.references.filter(
    (item) => item.provider === 'jira' && item.type === 'issue'
  )
  const unique = [
    ...new Map(references.map((item) => [getWorkspaceReferenceIdentity(item), item])).values()
  ]
  if (unique.length !== 1) {
    throw jiraAgentError(
      unique.length ? 'jira_current_ambiguous' : 'jira_no_linked_issue',
      unique.length
        ? 'Multiple Jira issues are linked. Pass an explicit key or URL.'
        : 'No Jira issue is linked. Use worktree set --jira-issue or pass an explicit key.'
    )
  }
  const issue = unique[0]
  const identity = issue.taskSourceContext?.providerIdentity
  const key = getWorkspaceReferenceIdentifier(issue) ?? parseJiraIssueUrl(issue.url ?? '')?.issueKey
  if (!key) {
    throw jiraAgentError(
      'jira_no_linked_issue',
      'The linked issue has no valid Jira identity. Relink it with worktree set --jira-issue.'
    )
  }
  return {
    key,
    url: issue.url,
    siteId: identity?.provider === 'jira' ? identity.siteId : undefined
  }
}

export const JIRA_CURRENT_ISSUE_METHODS = [
  defineMethod({
    name: 'jira.currentIssue',
    permission: 'workspace',
    params: AgentCurrentIssue,
    handler: async (context, { runtime }) => {
      let selector: string | undefined
      if (context.terminalHandle) {
        try {
          const terminal = await runtime.showTerminal(context.terminalHandle)
          if (context.worktreeId && context.worktreeId !== terminal.worktreeId) {
            throw jiraAgentError(
              'jira_permission_denied',
              'The current worktree does not match the caller terminal. Pass an explicit issue key.'
            )
          }
          selector = `id:${terminal.worktreeId}`
        } catch {
          if (context.remote || context.worktreeId) {
            throw jiraAgentError(
              'jira_issue_required',
              'Could not verify the current workspace. Pass an explicit issue key or URL.'
            )
          }
        }
      }
      if (!selector && context.remote !== true && context.cwd) {
        selector = 'current'
      }
      if (!selector) {
        throw jiraAgentError(
          'jira_issue_required',
          'Run --current inside an Orca workspace or pass an explicit issue key or URL.'
        )
      }
      return currentJiraReference(
        await runtime.listWorkspaceReferences(selector, context.remote ? undefined : context.cwd)
      )
    }
  })
]

import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { resolveJiraTarget } from './jira-target'
import { RuntimeClientError } from '../runtime/types'
import { callJiraWrite, jiraWriteFailure } from './jira-write-call'

export const JIRA_LINK_WRITE_HANDLERS: Record<string, CommandHandler> = {
  'jira link add': async (context) => {
    const urlInput = getRequiredStringFlag(context.flags, 'url')
    try {
      const url = new URL(urlInput)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Invalid remote link URL.')
      }
    } catch {
      throw new RuntimeClientError('invalid_argument', 'Pass an HTTP(S) URL without credentials.')
    }
    const target = await resolveJiraTarget(context, getRequiredStringFlag(context.flags, 'key'))
    const response = await callJiraWrite<{ ok: true; id: string } | { ok: false; error: string }>(
      context,
      'jira.addRemoteLink',
      {
        key: target.key,
        siteId: target.siteId,
        url: urlInput,
        title: getOptionalStringFlag(context.flags, 'title')
      },
      true
    )
    if (!response.result.ok) {
      throw jiraWriteFailure(response.result)
    }
    printResult(response, context.json, () => `Linked ${target.key} (${target.siteId})`)
  }
}

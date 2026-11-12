import { expect, it } from 'vitest'
import type { HandlerContext } from './dispatch'
import { RuntimeClientError } from './runtime-client'
import { callJiraRead } from './jira-read-call'

it('does not expose a credential-bearing provider error', async () => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callJiraRead only consumes client.call, which always rejects here.
  const context = {
    client: {
      call: async () => {
        throw new RuntimeClientError(
          'internal_error',
          'Error 403: Bearer secret-token Cookie: secret-cookie'
        )
      }
    }
  } as unknown as HandlerContext
  const failure = await callJiraRead(context, 'jira.searchIssues').catch((error: unknown) => error)
  expect(failure).toMatchObject({ code: 'jira_permission_denied' })
  expect(JSON.stringify(failure)).not.toContain('secret-token')
  expect(String(failure)).not.toContain('secret-cookie')
})

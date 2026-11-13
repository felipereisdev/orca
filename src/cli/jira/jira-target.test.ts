import { describe, expect, it } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import { JIRA_AGENT_ACCESS_RUNTIME_CAPABILITY } from '../../shared/jira/jira-agent-capability'
import { resolveJiraTarget } from './jira-target'

const first = { id: 'one', siteUrl: 'https://one.atlassian.net' }
const second = { id: 'two', siteUrl: 'https://two.atlassian.net' }

function context(sites: (typeof first)[], site?: string): HandlerContext {
  return {
    cwd: '/tmp',
    json: true,
    flags: new Map(site ? [['site', site]] : []),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only call is consumed by target resolution.
    client: {
      call: async (method: string) => ({
        result:
          method === 'status.get'
            ? { capabilities: [JIRA_AGENT_ACCESS_RUNTIME_CAPABILITY] }
            : { sites, selectedSiteId: 'one' }
      })
    } as HandlerContext['client']
  }
}

describe('Jira site identity', () => {
  it('reports missing connections with the stable recovery code', async () => {
    await expect(resolveJiraTarget(context([]), 'ABC-1')).rejects.toMatchObject({
      code: 'jira_not_connected'
    })
  })
  it('does not guess a bare key site from the UI selection', async () => {
    await expect(resolveJiraTarget(context([first, second]), 'ABC-1')).rejects.toMatchObject({
      code: 'jira_ambiguous_site'
    })
  })
  it('uses the only connected site', async () => {
    await expect(resolveJiraTarget(context([second]), 'abc-1')).resolves.toMatchObject({
      siteId: 'two',
      key: 'ABC-1'
    })
  })
  it('pins URLs to their connected origin', async () => {
    await expect(
      resolveJiraTarget(context([first, second]), 'https://two.atlassian.net/browse/ABC-1')
    ).resolves.toMatchObject({ siteId: 'two', key: 'ABC-1' })
  })
  it('rejects a URL conflicting with an explicit site', async () => {
    await expect(
      resolveJiraTarget(context([first, second], 'one'), 'https://two.atlassian.net/browse/ABC-1')
    ).rejects.toMatchObject({ code: 'jira_issue_not_found' })
  })
})

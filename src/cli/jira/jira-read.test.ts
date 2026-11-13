import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const call = vi.hoisted(() => vi.fn())
vi.mock('../runtime/client', async () => ({
  ...(await import('../runtime/types.js')),
  RuntimeClient: class {
    isRemote = false
    call = call
  }
}))

import { main } from '../index'
import { okFixture } from '../runtime/fixtures/runtime-rpc-fixtures'
import { JIRA_AGENT_ACCESS_RUNTIME_CAPABILITY } from '../../shared/jira/jira-agent-capability'

const issue = {
  id: '1',
  key: 'NDC-1163',
  siteId: 'site',
  title: 'Review requested text',
  summary: 'Review requested text',
  description: '**Expected** behavior',
  url: 'https://jira.example/browse/NDC-1163',
  project: { id: '1', key: 'NDC', name: 'NDC' },
  issueType: { id: '1', name: 'Bug' },
  status: { id: '1', name: 'Open', categoryName: 'To Do', categoryKey: 'new' },
  labels: [],
  createdAt: '2026-11-10',
  updatedAt: '2026-11-12',
  truncated: false
}

beforeEach(() => {
  call.mockReset()
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  call.mockImplementation(async (method: string) => {
    switch (method) {
      case 'status.get':
        return okFixture('status', { capabilities: [JIRA_AGENT_ACCESS_RUNTIME_CAPABILITY] })
      case 'jira.status':
        return okFixture('sites', {
          connected: true,
          sites: [{ id: 'site', siteUrl: 'https://jira.example' }]
        })
      case 'jira.issueContext':
        return okFixture('issue', {
          ...issue,
          comments: [{ id: '1', body: '- Requested text', createdAt: '2026-11-12' }],
          attachments: [{ id: '10', filename: 'screen.png', mimeType: 'image/png', size: 3 }]
        })
      case 'jira.agentSearchIssues':
        return okFixture('list', { issues: [issue], truncated: true })
      default:
        throw new Error(`Unexpected RPC: ${method}`)
    }
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

it('reads a ticket with comments and attachment identities through the standard envelope', async () => {
  await main(['jira', 'issue', 'NDC-1163', '--comments', '--attachments', '--json'], '/tmp')
  expect(process.exitCode).toBeUndefined()
  const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))
  expect(output).toMatchObject({
    ok: true,
    _meta: { runtimeId: 'runtime-1' },
    result: {
      key: 'NDC-1163',
      summary: 'Review requested text',
      description: '**Expected** behavior',
      comments: [{ body: '- Requested text' }],
      attachments: [{ id: '10', filename: 'screen.png' }]
    }
  })
})

it('retains the list array envelope and reports server truncation', async () => {
  await main(['jira', 'list', '--jql', 'key = NDC-1163', '--json'], '/tmp')
  expect(process.exitCode).toBeUndefined()
  const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))
  expect(output).toMatchObject({
    ok: true,
    truncated: true,
    _meta: { truncated: true },
    result: [{ key: 'NDC-1163' }]
  })
})

it('accepts human text search and applies a project restriction without opening a window', async () => {
  await main(['jira', 'search', 'login failure', '--project', 'NDC', '--json'], '/tmp')
  expect(process.exitCode).toBeUndefined()
  expect(call).toHaveBeenCalledWith('jira.agentSearchIssues', {
    jql: 'project = "NDC" AND (text ~ "login failure*")',
    limit: 20,
    siteId: 'site'
  })
})

it('reports a disconnected app integration without requiring credentials or opening a window', async () => {
  call.mockImplementation(async (method: string) =>
    okFixture(
      'status',
      method === 'status.get'
        ? { capabilities: [JIRA_AGENT_ACCESS_RUNTIME_CAPABILITY] }
        : { connected: false, sites: [] }
    )
  )
  await main(['jira', 'issue', 'NDC-1163', '--json'], '/tmp')
  expect(process.exitCode).toBe(1)
  const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))
  expect(output).toMatchObject({ ok: false, error: { code: 'jira_not_connected' } })
})

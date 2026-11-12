import { afterEach, describe, expect, it, vi } from 'vitest'
import { JIRA_AGENT_ACCESS_RUNTIME_CAPABILITY } from '../../shared/jira/jira-agent-capability'
import { reportCliError } from '../cli-error'
import type { HandlerContext } from '../dispatch'
import { RuntimeClientError, RuntimeRpcFailureError } from '../runtime-client'
import { JIRA_WRITE_HANDLERS } from './jira-write'
import { JIRA_LINK_WRITE_HANDLERS } from './jira-link-write'

const secret =
  'Authorization: Bearer private-token Cookie: private-cookie https://user:password@example.com/'
const cases = [
  { command: 'jira assignee clear', method: 'jira.updateIssue', flags: [] },
  { command: 'jira status set', method: 'jira.updateIssue', flags: [['to-id', 'done']] },
  {
    command: 'jira create',
    method: 'jira.createIssue',
    flags: [
      ['project', 'ENG'],
      ['type', 'task'],
      ['title', 'Title']
    ]
  },
  { command: 'jira comment add', method: 'jira.addIssueComment', flags: [['body', 'Comment']] },
  {
    command: 'jira link add',
    method: 'jira.addRemoteLink',
    flags: [['url', 'https://example.com/pr/3']]
  }
] as const

afterEach(() => vi.restoreAllMocks())

async function writeError(
  entry: (typeof cases)[number],
  result: unknown,
  thrown = false
): Promise<unknown> {
  const call = vi.fn(async (method: string) => {
    if (method === 'status.get') {
      return { result: { capabilities: [JIRA_AGENT_ACCESS_RUNTIME_CAPABILITY] } }
    }
    if (method === 'jira.status') {
      return { result: { sites: [{ id: 'site-1' }] } }
    }
    if (method === 'jira.listTransitions') {
      return { result: [{ id: 'done', name: 'Done', to: { name: 'Done' } }] }
    }
    if (method === 'jira.listProjects') {
      return { result: [{ id: 'project-1', key: 'ENG' }] }
    }
    if (method === entry.method) {
      if (thrown) {
        throw result
      }
      return { result }
    }
    throw new Error(`Unexpected method ${method}`)
  })
  const flags = new Map<string, string | boolean>([['key', 'ENG-3'], ...entry.flags])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers only use flags, cwd, json and the method-specific RPC stub here.
  const context = { flags, client: { call }, cwd: '/tmp', json: true } as unknown as HandlerContext
  const handler = { ...JIRA_WRITE_HANDLERS, ...JIRA_LINK_WRITE_HANDLERS }[entry.command]
  try {
    await handler(context)
  } catch (error) {
    return error
  }
  throw new Error('Expected a failed write')
}

function assertSafeOutput(error: unknown, code: string) {
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
  reportCliError(error, true)
  reportCliError(error, false)
  expect(error).toMatchObject({ code })
  const json = JSON.parse(String(stdout.mock.calls[0][0]))
  expect(json.error.code).toBe(code)
  const output = JSON.stringify([stdout.mock.calls, stderr.mock.calls])
  expect(output).not.toMatch(/private-token|private-cookie|user:password|provider-private/)
  expect(stderr.mock.calls[0][0]).toMatch(/Jira/)
}

describe.each(cases)('$command credential-free failures', (entry) => {
  it('does not print provider result errors in JSON or plain output', async () => {
    assertSafeOutput(await writeError(entry, { ok: false, error: secret }), 'jira_write_failed')
  })
  it('does not print unverified transport messages or recovery data', async () => {
    assertSafeOutput(
      await writeError(
        entry,
        new RuntimeClientError('runtime_timeout', secret, { nextSteps: ['provider-private'] }),
        true
      ),
      'jira_write_unverified'
    )
  })
  it('replaces provider RPC error envelopes, including their data', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the error envelope is consumed; transport metadata is irrelevant to this leak test.
    const error = new RuntimeRpcFailureError({
      ok: false,
      error: { code: 'runtime_error', message: secret, data: { nextSteps: ['provider-private'] } }
    } as ConstructorParameters<typeof RuntimeRpcFailureError>[0])
    assertSafeOutput(await writeError(entry, error, true), 'jira_write_failed')
  })
})

it.each([
  ['jira_permission_denied', 'jira_permission_denied'],
  ['jira_issue_not_found', 'jira_issue_not_found'],
  ['jira_not_connected', 'jira_not_connected'],
  ['jira.notConnected', 'jira_not_connected'],
  ['jira_write_unverified', 'jira_write_unverified']
])('preserves identifiable %s result codes without provider text', async (errorCode, expected) => {
  assertSafeOutput(await writeError(cases[0], { ok: false, error: secret, errorCode }), expected)
})

it.each([
  ['Error 403: ', 'jira_permission_denied'],
  ['HTTP 404 ', 'jira_issue_not_found'],
  ['HTTP 401 ', 'jira_not_connected']
])(
  'recognizes legacy provider status %s without exposing the response',
  async (prefix, expected) => {
    assertSafeOutput(await writeError(cases[0], { ok: false, error: prefix + secret }), expected)
  }
)

it('sanitizes unknown remote-link failures', async () => {
  assertSafeOutput(await writeError(cases[4], new Error(secret), true), 'jira_write_failed')
})

it.each([
  'jira_permission_denied',
  'jira_issue_not_found',
  'jira_not_connected',
  'jira_write_unverified'
])('preserves the explicit %s code ahead of provider text', async (code) => {
  assertSafeOutput(
    await writeError(
      cases[4],
      new RuntimeClientError(code, `HTTP 403 ${secret}`, { nextSteps: ['provider-private'] }),
      true
    ),
    code
  )
})

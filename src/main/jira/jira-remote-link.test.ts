import { beforeEach, expect, it, vi } from 'vitest'
import { addRemoteLink } from './jira-remote-link'

const { request, clients } = vi.hoisted(() => ({ request: vi.fn(), clients: vi.fn() }))
vi.mock('./authenticated-request', () => ({
  apiBasePath: () => '/rest/api/3',
  jiraRequest: request
}))
vi.mock('./client', () => ({ getClients: clients, clearToken: vi.fn(), isAuthError: () => false }))
vi.mock('./request-queue', () => ({ acquire: vi.fn(), release: vi.fn() }))
beforeEach(() => {
  request.mockReset()
  clients.mockReturnValue([{ site: { id: 'site-a' }, authorization: 'secret-token' }])
})
it('writes a remote link through the authenticated issue endpoint', async () => {
  request.mockResolvedValue({ id: 42 })
  expect(
    await addRemoteLink({
      key: 'ENG-3',
      siteId: 'site-a',
      url: 'https://gitlab.example/team/repo/-/merge_requests/7',
      title: 'Review'
    })
  ).toEqual({ ok: true, id: '42' })
  expect(request.mock.calls[0].slice(1)).toEqual([
    '/rest/api/3/issue/ENG-3/remotelink',
    {
      method: 'POST',
      body: '{"object":{"url":"https://gitlab.example/team/repo/-/merge_requests/7","title":"Review"}}'
    }
  ])
})
it('rejects credentials and executable URL schemes before a request', async () => {
  expect(
    await addRemoteLink({
      key: 'ENG-3',
      siteId: 'site-a',
      url: 'https://user:password@example.com/pr/3'
    })
  ).toEqual({ ok: false, error: 'Remote links require an HTTP(S) URL without credentials.' })
  expect(
    await addRemoteLink({ key: 'ENG-3', siteId: 'site-a', url: 'javascript:alert(1)' })
  ).toEqual({ ok: false, error: 'Remote links require an HTTP(S) URL without credentials.' })
  expect(request).not.toHaveBeenCalled()
})
it('does not expose Jira response bodies or credentials on uncertain failures', async () => {
  request.mockRejectedValue(new Error('Authorization: secret-token; cookie: private'))
  expect(
    await addRemoteLink({ key: 'ENG-3', siteId: 'site-a', url: 'https://example.com/pr/3' })
  ).toEqual({
    ok: false,
    error: 'Jira did not confirm the remote link. Verify in Jira before retrying.'
  })
})

it('sanitizes credential lookup failures before making a request', async () => {
  clients.mockImplementationOnce(() => {
    throw new Error('credential store failed: Authorization: Basic leaked-token')
  })
  await expect(
    addRemoteLink({ key: 'ENG-3', siteId: 'site-a', url: 'https://example.com/pr/3' })
  ).resolves.toEqual({
    ok: false,
    errorCode: 'jira_not_connected',
    error: 'Jira credentials are unavailable. Reconnect Jira in Orca Tasks.'
  })
  expect(request).not.toHaveBeenCalled()
})

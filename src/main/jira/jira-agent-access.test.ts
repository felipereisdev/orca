import { boundJiraAgentOutput } from '../../shared/jira/jira-agent-access'
import { describe, expect, it, vi } from 'vitest'
vi.mock('./client', () => ({
  getClients: vi.fn(() => [
    {
      site: { id: 'site', siteUrl: 'https://jira.example', displayName: 'Jira' },
      authorization: 'secret'
    }
  ])
}))
vi.mock('./jira-agile-fields', () => ({
  getAgileFieldIds: vi.fn(async () => ({})),
  agileFieldIdList: () => []
}))
vi.mock('./authenticated-request', () => ({
  apiBasePath: () => '/rest/api/3',
  apiBaseUrl: () => 'https://jira.example',
  jiraRequest: vi.fn(),
  jiraFetch: vi.fn()
}))
import { jiraRequest, jiraFetch } from './authenticated-request'
import { jiraIssueContext } from './jira-agent-context'
import { jiraAgentSearchIssues } from './jira-agent-search'
import { jiraAttachmentRead } from './jira-agent-attachment'

const issue = (description: unknown = '') => ({
  key: 'ABC-1',
  fields: {
    summary: 'Example',
    description,
    attachment: [
      {
        id: '12',
        filename: 'screen.png',
        mimeType: 'image/png',
        size: 3,
        content: 'https://jira.example/rest/api/3/attachment/content/12'
      }
    ]
  }
})
describe('Jira agent access', () => {
  it('renders nested Markdown and retains proven and unresolved media identities without binary reads', async () => {
    vi.mocked(jiraRequest).mockResolvedValueOnce(
      issue({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Bold', marks: [{ type: 'strong' }] }]
                  },
                  {
                    type: 'orderedList',
                    content: [
                      {
                        type: 'listItem',
                        content: [
                          {
                            type: 'paragraph',
                            content: [
                              {
                                type: 'text',
                                text: 'Link',
                                marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          { type: 'media', attrs: { id: '12' } },
          { type: 'media', attrs: { id: 'unknown' } }
        ]
      })
    )
    const result = await jiraIssueContext({ key: 'ABC-1', siteId: 'site', attachments: true })
    expect(result.description).toBe(
      '- **Bold**\n  1. [Link](https://example.com)\n\n[Attachment: screen.png (id: 12)]\n\n[Media: unknown]'
    )
    expect(result.attachments).toEqual([
      { id: '12', filename: 'screen.png', mimeType: 'image/png', size: 3 }
    ])
  })
  it('matches image sequences without treating ordinary attachment hyperlinks as images', async () => {
    const raw = {
      ...issue({
        type: 'doc',
        content: [
          { type: 'media', attrs: { id: 'uuid-12' } },
          { type: 'media', attrs: { id: 'uuid-34' } }
        ]
      }),
      renderedFields: {
        description:
          '<a href="/secure/attachment/34/screenshot.png">older screenshot</a><img src="/secure/attachment/12/screen.png"><img src="/secure/attachment/34/screenshot.png">'
      }
    }
    raw.fields.attachment.push({
      id: '34',
      filename: 'screenshot.png',
      mimeType: 'image/png',
      size: 3,
      content: 'https://jira.example/rest/api/3/attachment/content/34'
    })
    vi.mocked(jiraRequest).mockResolvedValueOnce(raw)
    expect((await jiraIssueContext({ key: 'ABC-1', siteId: 'site' })).description).toBe(
      '[Attachment: screen.png (id: 12)]\n\n[Attachment: screenshot.png (id: 34)]'
    )
  })
  it('resolves repeated proven media IDs and preserves unknown media despite matching alt text', async () => {
    vi.mocked(jiraRequest).mockResolvedValueOnce(
      issue({
        type: 'doc',
        content: [
          { type: 'media', attrs: { id: '12' } },
          { type: 'media', attrs: { id: '12' } },
          { type: 'media', attrs: { id: 'unknown', alt: 'screen.png' } }
        ]
      })
    )
    expect((await jiraIssueContext({ key: 'ABC-1', siteId: 'site' })).description).toBe(
      '[Attachment: screen.png (id: 12)]\n\n[Attachment: screen.png (id: 12)]\n\n[Media: unknown]'
    )
  })
  it('bounds descriptions and comment bodies and reports truncation', async () => {
    vi.mocked(jiraRequest)
      .mockResolvedValueOnce(issue('x'.repeat(20001)))
      .mockResolvedValueOnce({ comments: [{ id: '1', body: 'y'.repeat(20001) }], total: 1 })
    const result = await jiraIssueContext({ key: 'ABC-1', siteId: 'site', comments: true })
    expect(result.description?.length).toBe(20000)
    expect(result.comments?.[0].body.length).toBe(20000)
    expect(result.truncated).toBe(true)
  })
  it('caps comment pages and attachment collections', async () => {
    const raw = issue()
    raw.fields.attachment = Array.from({ length: 101 }, (_, index) => ({
      id: String(index),
      filename: 'screen.png',
      mimeType: 'image/png',
      size: 3,
      content: 'https://jira.example/content'
    }))
    vi.mocked(jiraRequest)
      .mockResolvedValueOnce(raw)
      .mockResolvedValue({
        comments: Array.from({ length: 50 }, () => ({ id: '1', body: 'comment' })),
        total: 501
      })
    const result = await jiraIssueContext({
      key: 'ABC-1',
      siteId: 'site',
      comments: true,
      attachments: true
    })
    expect(result.comments).toHaveLength(500)
    expect(result.attachments).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })
  it('transfers a full chunk with a continuation offset', async () => {
    const raw = issue()
    raw.fields.attachment[0].size = 262145
    vi.mocked(jiraRequest).mockResolvedValueOnce(raw)
    vi.mocked(jiraFetch).mockResolvedValueOnce(new Response(new Uint8Array(262145)))
    const result = await jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 0 })
    expect(Buffer.from(result.content, 'base64').length).toBe(262144)
    expect(result.nextOffset).toBe(262144)
  })
  it('follows short search pages and reports an extra issue truthfully', async () => {
    vi.mocked(jiraRequest)
      .mockResolvedValueOnce({ issues: [issue()], nextPageToken: 'second', isLast: false })
      .mockResolvedValueOnce({
        issues: [
          { ...issue(), key: 'ABC-2' },
          { ...issue(), key: 'ABC-3' }
        ],
        isLast: true
      })
    const result = await jiraAgentSearchIssues({ siteId: 'site', jql: 'project = ABC', limit: 2 })
    expect(result.issues.map((item) => item.key)).toEqual(['ABC-1', 'ABC-2'])
    expect(result.truncated).toBe(true)
  })
  it('returns complete searches without falsely claiming truncation', async () => {
    vi.mocked(jiraRequest).mockResolvedValueOnce({ issues: [issue()], isLast: true })
    const result = await jiraAgentSearchIssues({ siteId: 'site', limit: 20 })
    expect(result.issues.map((item) => item.key)).toEqual(['ABC-1'])
    expect(result.truncated).toBe(false)
  })
  it('rejects repeated search tokens instead of returning false completeness', async () => {
    vi.mocked(jiraRequest).mockResolvedValue({
      issues: [issue()],
      nextPageToken: 'same',
      isLast: false
    })
    await expect(jiraAgentSearchIssues({ siteId: 'site', limit: 20 })).rejects.toMatchObject({
      code: 'jira_read_failed'
    })
  })
  it('preserves issue identity after the text budget is exhausted', async () => {
    const raw = {
      ...issue('x'.repeat(20001)),
      fields: { ...issue().fields, labels: Array.from({ length: 100 }, () => 'x'.repeat(20000)) }
    }
    vi.mocked(jiraRequest).mockResolvedValueOnce(raw)
    const result = await jiraIssueContext({ key: 'ABC-1', siteId: 'site' })
    expect(result.key).toBe('ABC-1')
    expect(result.siteId).toBe('site')
    expect(result.url).toBe('https://jira.example/browse/ABC-1')
    expect(result.truncated).toBe(true)
  })
  it('reuses downloaded bytes across chunks while reauthorizing attachment membership', async () => {
    const raw = issue()
    raw.fields.attachment[0].size = 262145
    vi.mocked(jiraRequest).mockResolvedValue(raw)
    vi.mocked(jiraFetch)
      .mockResolvedValueOnce(new Response(new Uint8Array(262145)))
      .mockRejectedValueOnce(new Error('should not download again'))
    await jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 0 })
    await expect(
      jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 262144 })
    ).resolves.toMatchObject({ content: 'AA==', nextOffset: null })
    vi.mocked(jiraFetch).mockReset()
  })
  it('does not allow cached bytes after attachment access is revoked', async () => {
    const raw = issue()
    raw.fields.attachment[0].size = 262145
    vi.mocked(jiraRequest).mockResolvedValueOnce(raw)
    vi.mocked(jiraFetch).mockResolvedValueOnce(new Response(new Uint8Array(262145)))
    await jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 0 })
    vi.mocked(jiraRequest).mockResolvedValueOnce({ fields: { attachment: [] } })
    await expect(
      jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 262144 })
    ).rejects.toMatchObject({ code: 'jira_issue_not_found' })
  })
  it('restricts Cloud open searches to discovered projects', async () => {
    vi.mocked(jiraRequest)
      .mockResolvedValueOnce({ values: [{ id: '123' }], isLast: true })
      .mockImplementationOnce(async (_client, _path, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body.jql).toBe('project in ("123") AND statusCategory != Done ORDER BY updated DESC')
        return { issues: [issue()], isLast: true }
      })
    const result = await jiraAgentSearchIssues({ siteId: 'site', filter: 'all', limit: 20 })
    expect(result.issues.map((item) => item.key)).toEqual(['ABC-1'])
    expect(result.truncated).toBe(false)
  })
  it('bounds merged site results including JSON escaping while retaining issue identities', async () => {
    vi.mocked(jiraRequest).mockResolvedValueOnce({ issues: [issue()], isLast: true })
    const source = (await jiraAgentSearchIssues({ siteId: 'site', limit: 20 })).issues[0]
    const merged = boundJiraAgentOutput(
      Array.from({ length: 50 }, (_, index) => ({
        ...source,
        key: `ABC-${index}`,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-11-12T12:00:00Z',
        status: {
          id: '1',
          name: 'In Progress',
          categoryKey: 'indeterminate',
          categoryName: 'In Progress'
        },
        title: '"'.repeat(20000),
        labels: Array.from({ length: 100 }, () => 'x'.repeat(1000))
      }))
    )
    expect(JSON.stringify(merged).length).toBeLessThanOrEqual(100000)
    expect(merged.issues).toHaveLength(50)
    expect(merged.issues[49].key).toBe('ABC-49')
    expect(merged.issues[49].url).toBe('https://jira.example/browse/ABC-1')
    expect(merged.issues[49].updatedAt).toBe('2026-11-12T12:00:00Z')
    expect(merged.issues[49].createdAt).toBe('2026-01-01T00:00:00Z')
    expect(merged.issues[49].status.name).toBe('In Progress')
    expect(merged.truncated).toBe(true)
  })
  it('sanitizes provider permission errors', async () => {
    vi.mocked(jiraRequest).mockRejectedValueOnce({ status: 403, message: 'Authorization: secret' })
    await expect(jiraIssueContext({ key: 'ABC-1', siteId: 'site' })).rejects.toThrow(
      'jira_permission_denied: Jira denied access to this resource.'
    )
  })
  it('rejects attachments absent from issue metadata', async () => {
    vi.mocked(jiraRequest).mockResolvedValueOnce(issue())
    await expect(
      jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '999', offset: 0 })
    ).rejects.toThrow('jira_issue_not_found')
  })
  it('returns authenticated bytes and rejects actual size mismatches and cross-origin redirects', async () => {
    vi.mocked(jiraRequest).mockResolvedValue(issue())
    vi.mocked(jiraFetch).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
    await expect(
      jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 1 })
    ).resolves.toMatchObject({ content: 'AgM=', offset: 1, nextOffset: null, size: 3 })
    vi.mocked(jiraFetch).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4])))
    await expect(
      jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 0 })
    ).rejects.toThrow('jira_attachment_size_mismatch')
    vi.mocked(jiraFetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://evil.example/secret' } })
    )
    await expect(
      jiraAttachmentRead({ key: 'ABC-1', siteId: 'site', id: '12', offset: 0 })
    ).rejects.toThrow('jira_read_failed')
  })
})

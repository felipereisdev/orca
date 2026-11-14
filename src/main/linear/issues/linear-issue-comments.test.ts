import { buildSchema, graphql } from 'graphql'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getClients, getPublicFileUrlClient, isAuthError } = vi.hoisted(() => ({
  getClients: vi.fn(),
  getPublicFileUrlClient: vi.fn(),
  isAuthError: vi.fn()
}))

vi.mock('../accounts/linear-account-client', () => ({
  getClients,
  getPublicFileUrlClient,
  isAuthError
}))
vi.mock('../accounts/linear-token-store', () => ({ clearToken: vi.fn() }))
vi.mock('../requests/linear-request-concurrency', () => ({ acquire: vi.fn(), release: vi.fn() }))

import { getIssueComments } from './linear-issue-comments'

// A server answers only the fields the query selects, so a dropped selection is caught here.
const schema = buildSchema(`
  type User { id: ID!, displayName: String, avatarUrl: String }
  type Comment { id: ID!, body: String, createdAt: String, user: User }
  type CommentConnection { nodes: [Comment!]! }
  type Issue { comments(first: Int): CommentConnection! }
  type Query { issue(id: String!): Issue }
`)

const rootValue = {
  issue: () => ({
    comments: {
      nodes: [
        {
          id: 'comment-1',
          body: 'Looks good',
          createdAt: '2026-11-14T10:00:00.000Z',
          user: { id: 'user-ada', displayName: 'Ada', avatarUrl: null }
        }
      ]
    }
  })
}

async function rawRequest(query: string, variables: Record<string, unknown>) {
  const result = await graphql({ schema, source: query, rootValue, variableValues: variables })
  if (result.errors?.length) {
    throw result.errors[0]
  }
  return { data: result.data }
}

beforeEach(() => {
  vi.resetAllMocks()
  getClients.mockReturnValue([{ workspace: { id: 'workspace-1' } }])
  getPublicFileUrlClient.mockReturnValue({ client: { rawRequest } })
})

describe('getIssueComments', () => {
  it('keeps the author id so callers can tell the viewer’s own comments apart', async () => {
    await expect(getIssueComments('issue-1', 'workspace-1')).resolves.toEqual([
      {
        id: 'comment-1',
        body: 'Looks good',
        createdAt: '2026-11-14T10:00:00.000Z',
        user: { id: 'user-ada', displayName: 'Ada', avatarUrl: undefined }
      }
    ])
  })

  it('rethrows a failed read in strict mode instead of reporting no comments', async () => {
    getPublicFileUrlClient.mockReturnValue({
      client: { rawRequest: () => Promise.reject(new Error('Network error')) }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(getIssueComments('issue-1', 'workspace-1')).resolves.toEqual([])
    await expect(getIssueComments('issue-1', 'workspace-1', true)).rejects.toThrow('Network error')
  })
})

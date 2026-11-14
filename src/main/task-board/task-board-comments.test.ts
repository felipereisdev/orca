import { describe, expect, it } from 'vitest'
import type { GitHubWorkItemDetails } from '../../shared/github/work-items/work-item-types'
import type { Repo } from '../../shared/repo-types'
import { isValidGitHubApiRepository } from '../github/repositories/github-api-repository-validation'
import { readTaskBoardComments, type TaskBoardCommentDeps } from './task-board-comments'

const unexpected = () => Promise.reject(new Error('not this provider'))

function commentDeps(overrides: Partial<TaskBoardCommentDeps>): TaskBoardCommentDeps {
  return {
    repo: () => null,
    getLocalGitArgs: () => [],
    jiraSites: () => [],
    jiraComments: unexpected,
    linearComments: unexpected,
    linearViewerId: unexpected,
    gitlabWorkItemDetails: unexpected,
    githubWorkItemDetails: unexpected,
    ...overrides
  }
}

describe('readTaskBoardComments', () => {
  it('marks a comment as own by the account of the issue’s site, not the active one', async () => {
    const deps = commentDeps({
      jiraSites: () => [
        { id: 'site-a', accountId: 'account-a' },
        { id: 'site-b', accountId: 'account-b' }
      ],
      jiraComments: async (key, siteId) =>
        key === 'OPS-7' && siteId === 'site-b'
          ? [
              {
                id: '10',
                body: 'Deployed',
                createdAt: '2026-11-14T10:00:00.000Z',
                user: { accountId: 'account-b', displayName: 'Me on B' }
              },
              {
                id: '11',
                body: 'Thanks',
                createdAt: '2026-11-14T11:00:00.000Z',
                user: { accountId: 'account-a', displayName: 'Someone' }
              }
            ]
          : []
    })

    const comments = await readTaskBoardComments(
      { ref: { provider: 'jira', siteId: 'site-b', key: 'OPS-7' } },
      deps
    )

    expect(comments.map(({ id, own }) => ({ id, own }))).toEqual([
      { id: '10', own: true },
      { id: '11', own: false }
    ])
  })

  it('reads a GitHub issue from the repository the card pinned, not the checkout’s default', async () => {
    const fork: Repo = {
      id: 'fork',
      path: '/src/fork',
      displayName: 'fork',
      badgeColor: '',
      addedAt: 1
    }
    const details: GitHubWorkItemDetails = {
      item: {
        id: 'issue-5',
        type: 'issue',
        number: 5,
        title: 'Refunds',
        state: 'open',
        url: 'https://github.com/upstream/app/issues/5',
        labels: [],
        updatedAt: '2026-11-14T10:00:00Z',
        author: 'someone'
      },
      body: '',
      comments: [
        {
          id: 7,
          author: 'me',
          authorAvatarUrl: '',
          body: 'On it',
          createdAt: '2026-11-14T10:00:00Z',
          url: 'https://github.com/upstream/app/issues/5#issuecomment-7',
          viewerDidAuthor: true
        }
      ]
    }
    const deps = commentDeps({
      repo: (id) => (id === 'fork' ? fork : null),
      // Like gh: the fork's own issue #5 does not exist; upstream's does.
      githubWorkItemDetails: async (_path, _number, _type, _connection, _git, _pref, repository) =>
        isValidGitHubApiRepository(repository) && repository.owner === 'upstream' ? details : null
    })

    const comments = await readTaskBoardComments(
      {
        ref: {
          provider: 'github',
          repoId: 'fork',
          number: 5,
          issueRepo: { owner: 'upstream', repo: 'app' }
        }
      },
      deps
    )

    expect(comments).toEqual([
      { id: '7', author: 'me', at: '2026-11-14T10:00:00Z', body: 'On it', own: true }
    ])
  })
})

import { expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import { WORKTREE_HANDLERS } from './worktree'

it.each(['worktree create', 'worktree set'])(
  '%s rejects incompatible Jira and legacy link flags',
  async (command) => {
    for (const flag of ['reference', 'pr', 'issue', 'linear-issue', 'gitlab-issue', 'gitlab-mr']) {
      const call = vi.fn()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: rejection must occur before client access; only flags are read by this path.
      const context = {
        flags: new Map([
          ['jira-issue', 'ENG-3'],
          [flag, '42']
        ]),
        client: { call },
        cwd: '/tmp',
        json: true
      } as unknown as HandlerContext
      await expect(WORKTREE_HANDLERS[command](context)).rejects.toMatchObject({
        code: 'invalid_argument',
        message: expect.stringContaining(`Cannot combine --jira-issue with --${flag}`)
      })
    }
  }
)

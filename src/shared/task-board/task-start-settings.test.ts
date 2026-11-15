import { describe, expect, it } from 'vitest'
import {
  normalizeTaskStartRoles,
  resolveTaskStartRoles,
  resolveTaskStartWorkspaceMode
} from './task-start-settings'

const FOLDER_KIND = 'folder'

describe('task start settings', () => {
  it('drops effort without a model and accounts on non-claude agents', () => {
    expect(
      normalizeTaskStartRoles({
        reviewer: { agent: 'codex', accountId: 'acc-1', effort: 'high' },
        qa: { agent: 'claude', accountId: 'acc-1', model: 'opus', effort: 'high' },
        bogus: { agent: 'claude' }
      })
    ).toEqual({
      reviewer: { agent: 'codex' },
      qa: { agent: 'claude', accountId: 'acc-1', model: 'opus', effort: 'high' }
    })
  })

  it('resolves overrides over repo over global, copying the orchestrator into unset roles', () => {
    const roles = resolveTaskStartRoles({
      global: {
        roles: { orchestrator: { agent: 'claude', model: 'opus' }, qa: { agent: 'codex' } }
      },
      repo: { roles: { qa: { agent: 'claude', accountId: 'a2' } } },
      defaultAgent: 'codex',
      overrides: { reviewer: { agent: 'codex', model: 'gpt-6-astra', effort: 'high' } }
    })
    expect(roles?.qa).toEqual({ agent: 'claude', accountId: 'a2' })
    expect(roles?.reviewer).toEqual({ agent: 'codex', model: 'gpt-6-astra', effort: 'high' })
    expect(roles?.planner).toEqual({ agent: 'claude', model: 'opus' })
  })

  it('falls back to the default agent, and to null for blank', () => {
    expect(
      resolveTaskStartRoles({ global: { roles: {} }, defaultAgent: 'codex' })?.implementer
    ).toEqual({ agent: 'codex' })
    expect(resolveTaskStartRoles({ global: { roles: {} }, defaultAgent: 'blank' })).toBeNull()
  })

  it('forces primary for folder repos', () => {
    expect(
      resolveTaskStartWorkspaceMode({ kind: FOLDER_KIND, taskStart: { workspaceMode: 'worktree' } })
    ).toBe('primary')
  })
})

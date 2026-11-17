import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/repository/repo-types'
import { DESKTOP_RPC_CALLER } from '../runtime/rpc/callers/rpc-caller-identity'
import type { RpcContext } from '../runtime/rpc/core'
import { taskStartWorktreeCreateArgs } from './task-start-branch-deps'
import type { TaskStartCard } from './task-start-context'

const repo: Repo = { id: 'r1', path: '/src/r1', displayName: 'r1', badgeColor: '', addedAt: 1 }
const card: TaskStartCard = {
  provider: 'gitlab',
  ref: { provider: 'gitlab', repoId: 'r1', number: 4827, projectRef: null },
  displayId: '#4827',
  title: '[P0] Professor: troca de e-mail',
  url: 'https://gitlab.example.com/g/p/-/issues/4827'
}

function context(fields: Omit<Partial<RpcContext>, 'runtime'>): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create args read only caller identity fields; the runtime is never touched.
  return { runtime: undefined as never, ...fields }
}

describe('taskStartWorktreeCreateArgs', () => {
  it("credits the desktop's own window to this host", () => {
    const args = taskStartWorktreeCreateArgs(
      context({
        clientId: 'desktop-renderer',
        clientKind: 'runtime',
        connectionId: 'desktop-ipc:1',
        caller: DESKTOP_RPC_CALLER
      }),
      repo,
      card,
      'origin/prod'
    )
    expect(args.creatorProvenance).toEqual({ kind: 'host' })
    expect(args.baseBranch).toBe('origin/prod')
  })

  it("credits a paired phone's start to the desktop it acts for", () => {
    const args = taskStartWorktreeCreateArgs(
      context({
        clientId: 'phone',
        clientKind: 'mobile',
        connectionId: 'ws:1',
        pairedDeviceId: 'phone-device',
        pairedDeviceParentId: 'desktop-device',
        caller: { kind: 'paired-device', deviceId: 'phone-device' }
      }),
      repo,
      card
    )
    expect(args.creatorProvenance).toEqual({ kind: 'paired-device', deviceId: 'desktop-device' })
  })

  it('still refuses an unauthenticated remote client', () => {
    expect(() =>
      taskStartWorktreeCreateArgs(
        context({ clientId: 'someone', clientKind: 'runtime', connectionId: 'ws:2' }),
        repo,
        card
      )
    ).toThrow('authenticated_device_identity_missing')
  })
})

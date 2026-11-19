import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import {
  copyRecordingsBeforeRemoval,
  preflightRecipeWorkspaceRemoval,
  type RemovalPreflightTarget
} from './workspace-removal-preflight'

const REC_A = { id: 'aaaaaaaaaaaaaaaa', path: '/rec/rec-aaaaaaaaaaaaaaaa.mp4', bytes: 10 }
const REC_B = { id: 'bbbbbbbbbbbbbbbb', path: '/rec/rec-bbbbbbbbbbbbbbbb.mp4', bytes: 20 }

const target: RemovalPreflightTarget = {
  runtimeId: 'vm-a',
  environmentId: 'env-a',
  workspaceId: 'repo::/workspace/repo-task',
  hasDesktop: true,
  asleep: false
}

function ok(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: 'req', ok: true, result, _meta: { runtimeId: 'env' } }
}
function failed(code: string): RuntimeRpcResponse<unknown> {
  return { id: 'req', ok: false, error: { code, message: code } }
}

type Answers = Partial<Record<string, RuntimeRpcResponse<unknown> | 'hang' | 'throw'>>

function makePorts(answers: Answers = {}, copied: readonly string[] = []) {
  const order: string[] = []
  const defaults: Record<string, RuntimeRpcResponse<unknown>> = {
    'git.status': ok({ entries: [], conflictOperation: 'unknown' }),
    'git.unpushedCommitCount': ok({ unpushedCommits: 0 }),
    'desktop.recordings.list': ok({ recordings: [REC_A] })
  }
  return {
    order,
    call: vi.fn(async (_env: string, method: string): Promise<RuntimeRpcResponse<unknown>> => {
      const answer = answers[method] ?? defaults[method] ?? failed('method_not_found')
      if (answer === 'hang') {
        return new Promise(() => {})
      }
      if (answer === 'throw') {
        throw new Error('socket closed')
      }
      return answer
    }),
    isCopied: (id: string) => copied.includes(id),
    copy: vi.fn(async (recording: { id: string }) => {
      order.push(`copy:${recording.id}`)
    }),
    stopDesktop: vi.fn((runtimeId: string) => {
      order.push(`stop:${runtimeId}`)
    })
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('recipe workspace removal preflight', () => {
  it('preflight is clean when recordings are copied and git is pushed', async () => {
    const ports = makePorts({}, [REC_A.id])
    await expect(preflightRecipeWorkspaceRemoval(target, ports)).resolves.toEqual({
      status: 'clean',
      recordingsNotCopied: [],
      dirtyFiles: 0,
      unpushedCommits: 0
    })
    expect(ports.call).toHaveBeenCalledWith(
      'env-a',
      'git.status',
      { worktree: 'id:repo::/workspace/repo-task' },
      expect.any(AbortSignal)
    )
  })

  it('uncopied recordings make it unsafe and copy-and-remove copies them before destroy', async () => {
    const ports = makePorts({
      'desktop.recordings.list': ok({ recordings: [REC_A, REC_B] })
    })
    await expect(preflightRecipeWorkspaceRemoval(target, ports)).resolves.toEqual({
      status: 'unsafe',
      recordingsNotCopied: [REC_A, REC_B],
      dirtyFiles: 0,
      unpushedCommits: 0
    })

    await expect(copyRecordingsBeforeRemoval(target, ports)).resolves.toEqual({
      ok: true,
      copied: 2
    })
    // The desktop sync stops only after every copy landed; the destroy comes after this answer.
    expect(ports.order).toEqual([`copy:${REC_A.id}`, `copy:${REC_B.id}`, 'stop:vm-a'])

    const failing = makePorts({ 'desktop.recordings.list': ok({ recordings: [REC_A, REC_B] }) })
    failing.copy.mockRejectedValueOnce(new Error('read failed'))
    await expect(copyRecordingsBeforeRemoval(target, failing)).resolves.toEqual({
      ok: false,
      reason: 'copy_failed'
    })
    expect(failing.stopDesktop).not.toHaveBeenCalled()
  })

  it('dirty files or unpushed commits make it unsafe', async () => {
    const dirty = makePorts(
      {
        'git.status': ok({
          entries: [{ path: 'a.ts' }, { path: 'b.ts' }],
          statusLength: 3,
          conflictOperation: 'unknown'
        })
      },
      [REC_A.id]
    )
    await expect(preflightRecipeWorkspaceRemoval(target, dirty)).resolves.toEqual({
      status: 'unsafe',
      recordingsNotCopied: [],
      dirtyFiles: 3,
      unpushedCommits: 0
    })

    const unpushed = makePorts({ 'git.unpushedCommitCount': ok({ unpushedCommits: 2 }) }, [
      REC_A.id
    ])
    await expect(
      preflightRecipeWorkspaceRemoval({ ...target, hasDesktop: false }, unpushed)
    ).resolves.toEqual({
      status: 'unsafe',
      recordingsNotCopied: [],
      dirtyFiles: 0,
      unpushedCommits: 2
    })
    // Without a desktop the recordings part is skipped, not failed.
    expect(unpushed.call).not.toHaveBeenCalledWith(
      expect.anything(),
      'desktop.recordings.list',
      expect.anything(),
      expect.anything()
    )
  })

  it('an unreachable environment is unchecked, not clean', async () => {
    const unreachable = makePorts({
      'git.status': failed('remote_runtime_unavailable'),
      'git.unpushedCommitCount': 'throw',
      'desktop.recordings.list': failed('remote_runtime_unavailable')
    })
    await expect(preflightRecipeWorkspaceRemoval(target, unreachable)).resolves.toMatchObject({
      status: 'unchecked',
      reason: 'unreachable'
    })

    // A git status that could not be read is not an empty tree.
    const unreadable = makePorts(
      { 'git.status': ok({ entries: [], conflictOperation: 'unknown', readError: 'fatal' }) },
      [REC_A.id]
    )
    await expect(preflightRecipeWorkspaceRemoval(target, unreadable)).resolves.toMatchObject({
      status: 'unchecked',
      reason: 'git_failed'
    })

    const asleep = makePorts()
    await expect(
      preflightRecipeWorkspaceRemoval({ ...target, asleep: true }, asleep)
    ).resolves.toMatchObject({ status: 'unchecked', reason: 'asleep' })
    expect(asleep.call).not.toHaveBeenCalled()

    vi.useFakeTimers()
    const hanging = makePorts({ 'git.unpushedCommitCount': 'hang' }, [REC_A.id])
    const pending = preflightRecipeWorkspaceRemoval(target, hanging)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).resolves.toMatchObject({ status: 'unchecked', reason: 'timeout' })
  })
})

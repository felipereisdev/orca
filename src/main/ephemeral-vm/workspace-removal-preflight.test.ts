import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import {
  copyRecordingsBeforeRemoval,
  preflightRecipeWorkspaceRemoval,
  type RemovalPreflightTarget
} from './workspace-removal-preflight'

const REC_A = { id: 'aaaaaaaaaaaaaaaa', path: '/rec/rec-aaaaaaaaaaaaaaaa.mp4', bytes: 10 }
const REC_B = { id: 'bbbbbbbbbbbbbbbb', path: '/rec/rec-bbbbbbbbbbbbbbbb.mp4', bytes: 20 }
const REC_C = { id: 'cccccccccccccccc', path: '/rec/rec-cccccccccccccccc.mp4', bytes: 30 }

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
type Recording = typeof REC_A

/** An environment whose recordings list reflects what it holds at each call. */
function makePorts(
  answers: Answers = {},
  options: { recordings?: Recording[]; copied?: string[] } = {}
) {
  const order: string[] = []
  const recordings = [...(options.recordings ?? [REC_A])]
  const copied = new Set(options.copied ?? [])
  const defaults: Record<string, RuntimeRpcResponse<unknown>> = {
    'git.status': ok({ entries: [], conflictOperation: 'unknown' }),
    'git.unpushedCommitCount': ok({ unpushedCommits: 0 })
  }
  return {
    order,
    recordings,
    call: vi.fn(async (_env: string, method: string): Promise<RuntimeRpcResponse<unknown>> => {
      const answer =
        answers[method] ??
        (method === 'desktop.recordings.list' ? ok({ recordings: [...recordings] }) : undefined) ??
        defaults[method] ??
        failed('method_not_found')
      if (answer === 'hang') {
        return new Promise(() => {})
      }
      if (answer === 'throw') {
        throw new Error('socket closed')
      }
      return answer
    }),
    isCopied: async (id: string) => copied.has(id),
    copy: vi.fn(async (recording: { id: string }) => {
      order.push(`copy:${recording.id}`)
      copied.add(recording.id)
    })
  }
}

/** Each copy lets the agent finish one more recording, as if it was still recording. */
function withLateRecordings(ports: ReturnType<typeof makePorts>, late: Recording[]) {
  ports.copy.mockImplementation(async (recording: { id: string }) => {
    ports.order.push(`copy:${recording.id}`)
    const next = late.shift()
    if (next) {
      ports.recordings.push(next)
    }
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('recipe workspace removal preflight', () => {
  it('preflight is clean when recordings are copied and git is pushed', async () => {
    const ports = makePorts({}, { copied: [REC_A.id] })
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
    const ports = makePorts({}, { recordings: [REC_A, REC_B] })
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
    expect(ports.order).toEqual([`copy:${REC_A.id}`, `copy:${REC_B.id}`])

    const failing = makePorts({}, { recordings: [REC_A, REC_B] })
    failing.copy.mockRejectedValueOnce(new Error('read failed'))
    await expect(copyRecordingsBeforeRemoval(target, failing)).resolves.toEqual({
      ok: false,
      reason: 'copy_failed'
    })
  })

  it('a recording finished during the copy is copied on the next pass', async () => {
    const ports = makePorts({}, { recordings: [REC_A] })
    withLateRecordings(ports, [REC_B])
    ports.isCopied = async (id: string) => ports.order.includes(`copy:${id}`)
    await expect(copyRecordingsBeforeRemoval(target, ports)).resolves.toEqual({
      ok: true,
      copied: 2
    })
    expect(ports.order).toEqual([`copy:${REC_A.id}`, `copy:${REC_B.id}`])
  })

  it('recordings still arriving after two passes answer unsafe with the new counts', async () => {
    const ports = makePorts({}, { recordings: [REC_A] })
    withLateRecordings(ports, [REC_B, REC_C])
    ports.isCopied = async (id: string) => ports.order.includes(`copy:${id}`)
    await expect(copyRecordingsBeforeRemoval(target, ports)).resolves.toEqual({
      ok: false,
      reason: 'still_pending',
      preflight: {
        status: 'unsafe',
        recordingsNotCopied: [REC_C],
        dirtyFiles: 0,
        unpushedCommits: 0
      }
    })
  })

  it('a final list that fails after copying answers unsafe with the last known recordings', async () => {
    const ports = makePorts({}, { recordings: [REC_A] })
    ports.isCopied = async (id: string) => ports.order.includes(`copy:${id}`)
    const listed = ports.call.getMockImplementation()
    let lists = 0
    ports.call.mockImplementation(async (env: string, method: string) => {
      if (method === 'desktop.recordings.list' && (lists += 1) > 1) {
        return failed('remote_runtime_unavailable')
      }
      return listed ? listed(env, method) : failed('method_not_found')
    })
    await expect(copyRecordingsBeforeRemoval(target, ports)).resolves.toMatchObject({
      ok: false,
      reason: 'still_pending',
      preflight: { status: 'unsafe', recordingsNotCopied: [REC_A] }
    })
  })

  it('dirty files or unpushed commits make it unsafe', async () => {
    const dirty = makePorts(
      {
        'git.status': ok({
          // One file staged and unstaged counts once.
          entries: [
            { path: 'a.ts', area: 'staged' },
            { path: 'a.ts', area: 'unstaged' },
            { path: 'b.ts', area: 'untracked' }
          ],
          statusLength: 3,
          didHitLimit: true,
          conflictOperation: 'unknown'
        })
      },
      { copied: [REC_A.id] }
    )
    await expect(preflightRecipeWorkspaceRemoval(target, dirty)).resolves.toEqual({
      status: 'unsafe',
      recordingsNotCopied: [],
      dirtyFiles: 2,
      dirtyFilesCapped: true,
      unpushedCommits: 0
    })

    const unpushed = makePorts(
      { 'git.unpushedCommitCount': ok({ unpushedCommits: 2 }) },
      { copied: [REC_A.id] }
    )
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
      { copied: [REC_A.id] }
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
    const hanging = makePorts({ 'git.unpushedCommitCount': 'hang' }, { copied: [REC_A.id] })
    const pending = preflightRecipeWorkspaceRemoval(target, hanging)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).resolves.toMatchObject({ status: 'unchecked', reason: 'timeout' })
  })
})

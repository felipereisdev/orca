import { vi } from 'vitest'
import { parseEphemeralVmRecipeResult } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'

export type FakeRecording = { id: string; path: string; bytes: number; createdAt: string }
export type FakeStreamCallbacks = {
  onEvent: (payload: { type: string; response?: unknown }) => void
  onClose: () => void
}
type FakeCall = { environmentId: string; method: string; params: Record<string, unknown> }
type FakeResponse =
  | { id: string; ok: true; result: unknown; _meta: { runtimeId: string } }
  | { id: string; ok: false; error: { code: string; message: string; data?: unknown } }

/** The checkout on the environment; files under it resolve as workspace files. */
export const FAKE_CHECKOUT = '/workspace/repo'
export const FAKE_RECORDINGS_DIR = '/home/agent/.orca/desktop-recordings'

function ok(result: unknown): FakeResponse {
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'vm' } }
}

function failure(code: string, message: string): FakeResponse {
  return { id: 'r', ok: false, error: { code, message } }
}

/** A recipe environment's Orca server as the host's runtime-environment transport reaches it. */
class DesktopEnvironmentFake {
  files = new Map<string, Buffer>()
  recordings: FakeRecording[] = []
  failLists = 0
  failReads = 0
  /** Reads of these paths fail this many more times. */
  failReadsFor = new Map<string, number>()
  /** Reads of these paths wait for the promise; a rejection fails the read. */
  readGates = new Map<string, Promise<void>>()
  /** While set, list answers wait for it; the answer is the snapshot taken when the list began. */
  listGate: Promise<void> | null = null
  /** Each successful configure answers with a fresh controller token, as the broker does. */
  configured = 0
  configure: (params: Record<string, unknown>) => FakeResponse | Promise<FakeResponse> = () =>
    this.configuredReply()
  streams: FakeStreamCallbacks[] = []
  closedStreams = 0
  calls: FakeCall[] = []
  /** Git answers a clean, pushed checkout; off, git checks fail (the removal is unchecked). */
  gitClean = false
  /** A recording is starting, running or finalizing, as the recorder reports it. */
  inProgress = false
  fenced = false
  fence: () => FakeResponse = () => {
    this.fenced = true
    return ok({ fenced: true })
  }
  stop: () => FakeResponse = () => failure('desktop_not_recording', 'not recording')
  /** Runs right after a list took its snapshot, as if it happened just after the list answered. */
  afterList: (() => void) | null = null

  reset(): void {
    this.files.clear()
    this.recordings = []
    this.failLists = 0
    this.failReads = 0
    this.failReadsFor.clear()
    this.readGates.clear()
    this.listGate = null
    this.configured = 0
    this.configure = () => this.configuredReply()
    this.streams = []
    this.closedStreams = 0
    this.calls = []
    this.gitClean = false
    this.inProgress = false
    this.fenced = false
    this.fence = () => {
      this.fenced = true
      return ok({ fenced: true })
    }
    this.stop = () => failure('desktop_not_recording', 'not recording')
    this.afterList = null
  }

  /** `desktop.record.start` as the recorder answers it: refused while a removal fences it. */
  startRecording(): 'started' | 'desktop_removal_pending' {
    if (this.fenced) {
      return 'desktop_removal_pending'
    }
    this.inProgress = true
    return 'started'
  }

  configuredReply(): FakeResponse {
    this.configured += 1
    return ok({ state: 'ready', controllerToken: `controller-token-${this.configured}` })
  }

  finishRecording(id: string, bytes: number, dir = FAKE_RECORDINGS_DIR): FakeRecording {
    const path = `${dir}/rec-${id}.mp4`
    this.files.set(path, Buffer.alloc(bytes, id.charCodeAt(0)))
    const recording = { id, path, bytes, createdAt: '2026-11-18T12:00:00.000Z' }
    this.recordings.push(recording)
    return recording
  }

  emit(stream: FakeStreamCallbacks | undefined, result: unknown): void {
    stream?.onEvent({ type: 'response', response: { id: 's', ok: true, result, _meta: {} } })
  }

  methods(): string[] {
    return this.calls.map((call) => call.method)
  }

  private async chunk(path: string, args: Record<string, unknown>): Promise<FakeResponse> {
    const gate = this.readGates.get(path)
    if (gate) {
      try {
        await gate
      } catch {
        return failure('io', 'connection reset')
      }
    }
    const failuresLeft = this.failReadsFor.get(path) ?? 0
    if (this.failReads > 0 || failuresLeft > 0) {
      if (failuresLeft > 0) {
        this.failReadsFor.set(path, failuresLeft - 1)
      } else {
        this.failReads -= 1
      }
      return failure('io', 'connection reset')
    }
    const file = this.files.get(path) ?? Buffer.alloc(0)
    const offset = Number(args.offset)
    const bytes = file.subarray(offset, offset + Number(args.length))
    return ok({
      contentBase64: bytes.toString('base64'),
      bytesRead: bytes.length,
      eof: offset + bytes.length >= file.length
    })
  }

  private async list(): Promise<FakeResponse> {
    // A snapshot, as a server answers: later recordings are not in an earlier answer.
    const snapshot = this.recordings.map((recording) => ({ ...recording }))
    const inProgress = this.inProgress
    this.afterList?.()
    const fails = this.failLists > 0
    if (fails) {
      this.failLists -= 1
    }
    if (this.listGate) {
      await this.listGate
    }
    return fails
      ? failure('remote_runtime_unavailable', 'unreachable')
      : ok({ recordings: snapshot, inProgress })
  }

  call(
    environmentId: string,
    method: string,
    params: unknown
  ): FakeResponse | Promise<FakeResponse> {
    const args: Record<string, unknown> =
      typeof params === 'object' && params !== null ? { ...params } : {}
    this.calls.push({ environmentId, method, params: args })
    switch (method) {
      case 'desktop.configure':
        return this.configure(args)
      case 'desktop.recordings.list':
        return this.list()
      case 'desktop.record.fence':
        return this.fence()
      case 'desktop.record.stop':
        return this.stop()
      case 'git.status':
        return this.gitClean ? ok({ entries: [] }) : failure('method_not_found', method)
      case 'git.unpushedCommitCount':
        return this.gitClean ? ok({ unpushedCommits: 0 }) : failure('method_not_found', method)
      case 'files.resolveTerminalPath': {
        const path = String(args.pathText)
        const worktree = String(args.worktree).slice('id:'.length)
        if (path.startsWith(`${FAKE_CHECKOUT}/`)) {
          return ok({
            worktree,
            openTarget: {
              kind: 'worktree-file',
              provider: 'local',
              relativePath: path.slice(FAKE_CHECKOUT.length + 1),
              absolutePath: path
            }
          })
        }
        return ok({
          worktree,
          openTarget: { kind: 'absolute-file', provider: 'local', absolutePath: path, grantId: 'g' }
        })
      }
      case 'files.readChunk':
        return this.chunk(`${FAKE_CHECKOUT}/${String(args.relativePath)}`, args)
      case 'files.readTerminalArtifactChunk':
        return this.chunk(String(args.absolutePath), args)
      default:
        return failure('method_not_found', method)
    }
  }

  subscribe(callbacks: FakeStreamCallbacks): { close: () => void } {
    this.streams.push(callbacks)
    return {
      close: () => {
        this.closedStreams += 1
        callbacks.onClose()
      }
    }
  }
}

export const desktopEnvironmentFake = new DesktopEnvironmentFake()

/** The transport-routing module, served by the fake; mock it with this in a `vi.mock` factory. */
export function fakeTransportRoutingModule() {
  return {
    callRuntimeEnvironment: vi.fn(
      async (_root: string, environmentId: string, method: string, params: unknown) =>
        desktopEnvironmentFake.call(environmentId, method, params)
    ),
    subscribeRuntimeEnvironment: vi.fn(
      async (
        _root: string,
        _environmentId: string,
        _method: string,
        _params: unknown,
        _timeoutMs: unknown,
        callbacks: FakeStreamCallbacks
      ) => desktopEnvironmentFake.subscribe(callbacks)
    )
  }
}

export function runningDesktopRuntimeFixture(): EphemeralVmRuntimeRecord {
  const parsed = parseEphemeralVmRecipeResult(
    JSON.stringify({
      schemaVersion: 1,
      connection: {
        type: 'ssh',
        projectRoot: '/workspace/repo',
        target: { label: 'VM', host: 'vm.example.com', port: 22, username: 'root' }
      },
      desktop: { type: 'vnc', port: 5901, password: 'abc12345' }
    })
  )
  if (!parsed.ok) {
    throw new Error('fixture recipe result did not parse')
  }
  return {
    id: 'vm-1',
    recipeId: 'cloud',
    repoId: 'repo-1',
    status: 'running',
    cleanupStatus: 'not_started',
    connectionMode: 'ssh',
    runtimeEnvironmentId: 'env-1',
    workspaceId: 'repo-1::/workspace/repo',
    recipeResult: parsed.result,
    createdAt: 0,
    updatedAt: 0
  }
}

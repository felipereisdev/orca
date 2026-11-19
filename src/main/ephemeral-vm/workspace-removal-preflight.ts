import { z } from 'zod'
import type { RuntimeRpcResponse } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import {
  RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS,
  type RecipeRemovalCopyFailure,
  type RecipeRemovalPreflight,
  type RecipeRemovalPreflightReason,
  type RecipeRemovalRecording
} from '../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import { parseEnvironmentRecording } from './desktop-recording-copies'

/** Copies run one at a time; a stuck copy must not hold the removal dialog forever. */
const COPY_BEFORE_REMOVAL_TIMEOUT_MS = 10 * 60_000

/** Copy passes before the removal gives up and reports what is still pending. */
const MAX_COPY_PASSES = 2

/** The recipe runtime that owns the workspace, as the host's own runtime store records it. */
export type RemovalPreflightTarget = {
  runtimeId: string
  environmentId: string
  workspaceId: string
  /** The recipe set up a desktop, so the environment may hold recordings. */
  hasDesktop: boolean
  /** The environment is suspended; its Orca can't answer. */
  asleep: boolean
}

export type RemovalPreflightPorts = {
  call: (
    environmentId: string,
    method: string,
    params: unknown,
    signal: AbortSignal
  ) => Promise<RuntimeRpcResponse<unknown>>
  /** True only when this Mac's copy still exists on disk. */
  isCopied: (recordingId: string) => Promise<boolean>
}

export type CopyBeforeRemovalPorts = RemovalPreflightPorts & {
  copy: (recording: RecipeRemovalRecording, signal: AbortSignal) => Promise<void>
}

// Codes that mean the environment's Orca never answered, as opposed to a check that failed there.
const UNREACHABLE_CODES = new Set([
  'timeout',
  'remote_runtime_unavailable',
  'runtime_unavailable',
  'runtime_environment_changed',
  'runtime_manually_disconnected',
  'runtime_environment_waking',
  'runtime_environment_wake_failed',
  'runtime_environment_asleep'
])

const GitStatus = z
  .object({
    entries: z.array(z.object({ path: z.string() }).passthrough()),
    didHitLimit: z.boolean().optional(),
    readError: z.string().optional()
  })
  .passthrough()
const UnpushedCommits = z.object({ unpushedCommits: z.number().int().nonnegative() }).passthrough()
const RecordingList = z.object({ recordings: z.array(z.unknown()) }).passthrough()

type Part<T> = { ok: true; value: T } | { ok: false; reason: RecipeRemovalPreflightReason }

async function ask<T>(
  ports: RemovalPreflightPorts,
  target: RemovalPreflightTarget,
  method: string,
  params: unknown,
  signal: AbortSignal,
  failure: RecipeRemovalPreflightReason,
  read: (result: unknown) => T | null
): Promise<Part<T>> {
  let response: RuntimeRpcResponse<unknown>
  try {
    response = await ports.call(target.environmentId, method, params, signal)
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: UNREACHABLE_CODES.has(response.error.code) ? 'unreachable' : failure
    }
  }
  const value = read(response.result)
  return value === null ? { ok: false, reason: failure } : { ok: true, value }
}

type DirtyFiles = { count: number; capped: boolean }

function readDirtyFiles(result: unknown): DirtyFiles | null {
  const status = GitStatus.safeParse(result).data
  // A status Git could not read lists no entries; that is not a clean tree.
  if (!status || status.readError !== undefined) {
    return null
  }
  return {
    count: new Set(status.entries.map((entry) => entry.path)).size,
    capped: status.didHitLimit === true
  }
}

function readUnpushedCommits(result: unknown): number | null {
  return UnpushedCommits.safeParse(result).data?.unpushedCommits ?? null
}

function readRecordings(result: unknown): RecipeRemovalRecording[] | null {
  const listed = RecordingList.safeParse(result).data
  if (!listed) {
    return null
  }
  return listed.recordings.flatMap((entry) => {
    const recording = parseEnvironmentRecording(entry)
    return recording ? [recording] : []
  })
}

async function listPendingRecordings(
  target: RemovalPreflightTarget,
  ports: RemovalPreflightPorts,
  signal: AbortSignal
): Promise<Part<RecipeRemovalRecording[]>> {
  if (!target.hasDesktop) {
    return { ok: true, value: [] }
  }
  const listed = await ask(
    ports,
    target,
    'desktop.recordings.list',
    {},
    signal,
    'recordings_failed',
    readRecordings
  )
  if (!listed.ok) {
    return listed
  }
  const copied = await Promise.all(listed.value.map((recording) => ports.isCopied(recording.id)))
  return { ok: true, value: listed.value.filter((_recording, index) => !copied[index]) }
}

/** Runs `work` until it settles or `timeoutMs` passes; the signal aborts on the deadline. */
async function withDeadline<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T | 'timeout'> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve('timeout')
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
  }
}

function unchecked(
  reason: RecipeRemovalPreflightReason,
  known: Partial<RecipeRemovalPreflight> = {}
): RecipeRemovalPreflight {
  return {
    status: 'unchecked',
    recordingsNotCopied: known.recordingsNotCopied ?? [],
    dirtyFiles: known.dirtyFiles ?? 0,
    ...(known.dirtyFilesCapped ? { dirtyFilesCapped: true } : {}),
    unpushedCommits: known.unpushedCommits ?? 0,
    reason
  }
}

/**
 * Asks the environment's Orca, within one bounded wait, what removing the workspace would lose:
 * recordings not yet on this Mac, uncommitted files, and commits on no remote. Any part that can't
 * answer makes the whole result `unchecked`, keeping the counts the other parts did learn.
 */
export async function preflightRecipeWorkspaceRemoval(
  target: RemovalPreflightTarget,
  ports: RemovalPreflightPorts,
  timeoutMs: number = RECIPE_REMOVAL_PREFLIGHT_TIMEOUT_MS
): Promise<RecipeRemovalPreflight> {
  if (target.asleep) {
    return unchecked('asleep')
  }
  const worktree = `id:${target.workspaceId}`
  const answered = await withDeadline(timeoutMs, (signal) =>
    Promise.all([
      ask(ports, target, 'git.status', { worktree }, signal, 'git_failed', readDirtyFiles),
      ask(ports, target, 'git.unpushedCommitCount', { worktree }, signal, 'git_failed', (r) =>
        readUnpushedCommits(r)
      ),
      listPendingRecordings(target, ports, signal)
    ])
  )
  if (answered === 'timeout') {
    return unchecked('timeout')
  }
  const [dirty, unpushed, recordings] = answered
  const known = {
    dirtyFiles: dirty.ok ? dirty.value.count : 0,
    ...(dirty.ok && dirty.value.capped ? { dirtyFilesCapped: true } : {}),
    unpushedCommits: unpushed.ok ? unpushed.value : 0,
    recordingsNotCopied: recordings.ok ? recordings.value : []
  }
  const failures = [dirty, unpushed, recordings].flatMap((part) => (part.ok ? [] : [part.reason]))
  if (failures.length > 0) {
    return unchecked(failures.includes('unreachable') ? 'unreachable' : failures[0], known)
  }
  const unsafe =
    known.dirtyFiles > 0 || known.unpushedCommits > 0 || known.recordingsNotCopied.length > 0
  return { status: unsafe ? 'unsafe' : 'clean', ...known }
}

/** The copy's outcome before main adds acknowledgements to it. */
export type CopyBeforeRemovalOutcome =
  | { ok: true; copied: number }
  | { ok: false; reason: RecipeRemovalCopyFailure }
  | { ok: false; reason: 'still_pending'; preflight: RecipeRemovalPreflight }

/**
 * Copies every recording the environment holds that this Mac lacks, one at a time and within one
 * bounded wait. A recording finished during a pass is picked up by the next one, up to two passes.
 * Only a final list that succeeds and finds nothing pending lets the removal go on; anything else
 * answers `unsafe` with the last pending list it knows. The desktop's sync keeps running: only the
 * environment's destroy stops it.
 */
export async function copyRecordingsBeforeRemoval(
  target: RemovalPreflightTarget,
  ports: CopyBeforeRemovalPorts,
  timeoutMs: number = COPY_BEFORE_REMOVAL_TIMEOUT_MS
): Promise<CopyBeforeRemovalOutcome> {
  if (target.asleep) {
    return { ok: false, reason: 'unreachable' }
  }
  let knownPending: RecipeRemovalRecording[] | null = null
  const outcome = await withDeadline(
    timeoutMs,
    async (signal): Promise<CopyBeforeRemovalOutcome | 'pending'> => {
      let copied = 0
      for (let pass = 0; pass <= MAX_COPY_PASSES; pass += 1) {
        const pending = await listPendingRecordings(target, ports, signal)
        if (!pending.ok) {
          if (knownPending) {
            return 'pending'
          }
          return {
            ok: false,
            reason: pending.reason === 'unreachable' ? 'unreachable' : 'unavailable'
          }
        }
        if (pending.value.length === 0) {
          return { ok: true, copied }
        }
        knownPending = pending.value
        if (pass === MAX_COPY_PASSES) {
          return 'pending'
        }
        for (const recording of pending.value) {
          try {
            await ports.copy(recording, signal)
          } catch {
            return { ok: false, reason: 'copy_failed' }
          }
          copied += 1
        }
      }
      return 'pending'
    }
  )
  if (outcome !== 'pending' && outcome !== 'timeout') {
    return outcome
  }
  if (!knownPending) {
    return { ok: false, reason: 'timeout' }
  }
  // Git work comes from a fresh check; the recordings are the last ones a list proved pending.
  const fresh = await preflightRecipeWorkspaceRemoval(target, ports)
  return {
    ok: false,
    reason: 'still_pending',
    preflight: {
      status: 'unsafe',
      recordingsNotCopied: knownPending,
      dirtyFiles: fresh.dirtyFiles,
      ...(fresh.dirtyFilesCapped ? { dirtyFilesCapped: true } : {}),
      unpushedCommits: fresh.unpushedCommits
    }
  }
}

import { vi } from 'vitest'
import type { EphemeralVmRuntimeRecord } from '../../../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type {
  RecipeRemovalCheckResult,
  RecipeRemovalClaimResult
} from '../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'

/** A recipe VM's runtime record, attached to a workspace. */
export function recipeRuntime(
  overrides: Partial<EphemeralVmRuntimeRecord>
): EphemeralVmRuntimeRecord {
  return {
    id: 'vm-a',
    recipeId: 'cloud',
    repoId: 'repo',
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

export const UNSAFE_CHECK: RecipeRemovalCheckResult = {
  status: 'unsafe',
  recordingsNotCopied: [],
  dirtyFiles: 0,
  unpushedCommits: 5,
  ack: 'ack-unsafe'
}

/**
 * A `window.api` whose recipe calls answer for the test and whose every other call resolves, so a
 * removal can run end to end through the real store and runtime code.
 */
export function recipeRemovalBridge(runtimes: EphemeralVmRuntimeRecord[]) {
  const ephemeralVm = {
    removalPreflight: vi.fn(async (_request: unknown) => UNSAFE_CHECK),
    confirmRemoval: vi.fn(async (_args: { ack: string }) => true),
    revokeRemoval: vi.fn(async (_args: { ack: string }) => {}),
    claimRemoval: vi.fn(async (_args: unknown): Promise<RecipeRemovalClaimResult> => ({
      ok: true,
      required: true
    })),
    adoptRemoval: vi.fn(async (_args: unknown): Promise<RecipeRemovalClaimResult> => ({
      ok: true,
      required: true
    })),
    releaseRemoval: vi.fn(async (_args: { hostId: string; workspaceId: string }) => {}),
    revokeRemovalSession: vi.fn(async (_args: { sessionId: string }) => {}),
    rollbackRemovalAck: vi.fn(async () => ''),
    copyRecordingsBeforeRemoval: vi.fn(),
    listRuntimes: vi.fn(async (_filter?: unknown) => runtimes),
    cleanup: vi.fn(async (args: { runtimeId: string; ack: string }) => ({
      ...(runtimes.find((runtime) => runtime.id === args.runtimeId) ?? recipeRuntime({})),
      status: 'cleaned',
      cleanupStatus: 'succeeded'
    }))
  }
  const known: Record<string, unknown> = { ephemeralVm }
  const anyCall = (): unknown => vi.fn(async () => undefined)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the removals under test reach ephemeralVm and fire-and-forget bridge calls, which the proxy answers with resolved promises.
  const api = new Proxy(known, {
    get: (target, namespace: string) =>
      target[namespace] ??
      new Proxy({}, { get: (_ns, method: string) => (method === 'then' ? undefined : anyCall()) })
  }) as unknown as typeof window.api
  return { api, ephemeralVm }
}

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../file-content/node-bounded-file-reader'
import {
  JsonStringifyByteLimitError,
  stringifyJsonWithinByteLimit
} from '../../json-stream/node-bounded-json-stringify'
import { writeSecureJsonFileWithinLimit } from '../../secure-storage/bounded-secure-json-file'
import { hardenExistingSecureFile } from '../../secure-storage/secure-file'
import {
  EphemeralVmRecipeDesktopSchema,
  type EphemeralVmRecipeDesktop
} from '../ephemeral-vm-recipes/ephemeral-vm-recipes'
import {
  EphemeralVmRuntimeRecordSchema,
  type EphemeralVmRuntimeRecord
} from './ephemeral-vm-runtimes'

const EPHEMERAL_VM_RUNTIME_FEATURES_FILE = 'orca-ephemeral-vm-runtime-features.json'
export const MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES = 1024 * 1024

const EphemeralVmRuntimeCheckoutFeatureRecordSchema = z
  .object({
    id: z.string().min(1),
    recipeId: z.string().min(1),
    createdAt: z.number().finite(),
    recipeCheckoutMode: z.enum(['orca-worktree', 'provisioned-root']).optional(),
    resultCheckoutMode: z.literal('provisioned-root').optional()
  })
  .strict()

// Separate record: older builds parse checkout records strictly and would drop one carrying `desktop`.
const EphemeralVmRuntimeDesktopFeatureRecordSchema = z
  .object({
    id: z.string().min(1),
    recipeId: z.string().min(1),
    createdAt: z.number().finite(),
    resultDesktop: EphemeralVmRecipeDesktopSchema
  })
  .strict()

export type EphemeralVmRuntimeFeatureEntry = z.infer<
  typeof EphemeralVmRuntimeCheckoutFeatureRecordSchema
> & { resultDesktop?: EphemeralVmRecipeDesktop }

const EphemeralVmRuntimeFeatureStoreSchema = z
  .object({
    version: z.literal(1),
    records: z.array(z.unknown())
  })
  .strict()

export type EphemeralVmRuntimeFeatureStoreSnapshot =
  | {
      writable: true
      features: EphemeralVmRuntimeFeatureEntry[]
      retainedRecords: unknown[]
    }
  | {
      writable: false
      features: []
      retainedRecords: []
    }

export function getEphemeralVmRuntimeFeatureStorePath(userDataPath: string): string {
  return join(userDataPath, EPHEMERAL_VM_RUNTIME_FEATURES_FILE)
}

export function assertEphemeralVmRuntimeCheckoutModeCanPersist(
  userDataPath: string,
  args: {
    id: string
    recipeId: string
    createdAt: number
    checkoutMode: NonNullable<NonNullable<EphemeralVmRuntimeRecord['recipe']>['checkoutMode']>
  }
): void {
  const snapshot = readEphemeralVmRuntimeFeatureStore(userDataPath)
  if (!snapshot.writable) {
    throw new Error('Could not preserve ephemeral VM runtime compatibility metadata.')
  }
  const required: EphemeralVmRuntimeFeatureEntry = {
    id: args.id,
    recipeId: args.recipeId,
    createdAt: args.createdAt,
    recipeCheckoutMode: args.checkoutMode,
    ...(args.checkoutMode === 'provisioned-root' ? { resultCheckoutMode: 'provisioned-root' } : {})
  }
  try {
    assertFeatureStoreCanPersist(snapshot, mergeFeatureEntries(snapshot.features, [required]))
  } catch (error) {
    if (error instanceof JsonStringifyByteLimitError) {
      throw new Error(
        'Could not preserve ephemeral VM runtime compatibility metadata; the feature store exceeds its durable capacity.'
      )
    }
    throw error
  }
}

export function readEphemeralVmRuntimeFeatureStore(
  userDataPath: string
): EphemeralVmRuntimeFeatureStoreSnapshot {
  const path = getEphemeralVmRuntimeFeatureStorePath(userDataPath)
  if (!existsSync(path)) {
    return { writable: true, features: [], retainedRecords: [] }
  }
  try {
    hardenExistingSecureFile(path)
    const parsed = EphemeralVmRuntimeFeatureStoreSchema.parse(
      JSON.parse(
        readNodeFileSyncWithinLimit(
          path,
          MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES
        ).buffer.toString('utf8')
      )
    )
    return parseFeatureRecords(parsed.records)
  } catch {
    return { writable: false, features: [], retainedRecords: [] }
  }
}

export function writeEphemeralVmRuntimeFeatureStore(
  userDataPath: string,
  snapshot: EphemeralVmRuntimeFeatureStoreSnapshot,
  features: EphemeralVmRuntimeFeatureEntry[]
): void {
  if (!snapshot.writable) {
    throw new Error('The ephemeral VM runtime feature store is not writable.')
  }
  writeSecureJsonFileWithinLimit(
    getEphemeralVmRuntimeFeatureStorePath(userDataPath),
    runtimeFeatureStoreValue(snapshot, features),
    MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES,
    { durable: true }
  )
}

function assertFeatureStoreCanPersist(
  snapshot: EphemeralVmRuntimeFeatureStoreSnapshot,
  features: EphemeralVmRuntimeFeatureEntry[]
): void {
  if (!snapshot.writable) {
    throw new Error('The ephemeral VM runtime feature store is not writable.')
  }
  stringifyJsonWithinByteLimit(
    runtimeFeatureStoreValue(snapshot, features),
    MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES
  )
}

function mergeFeatureEntries(
  existing: readonly EphemeralVmRuntimeFeatureEntry[],
  required: readonly EphemeralVmRuntimeFeatureEntry[]
): EphemeralVmRuntimeFeatureEntry[] {
  const merged = new Map(existing.map((entry) => [featureIdentity(entry), entry]))
  for (const entry of required) {
    merged.set(featureIdentity(entry), entry)
  }
  return sortRuntimeFeatures([...merged.values()])
}

export function featureEntryFromRuntime(
  runtime: EphemeralVmRuntimeRecord
): EphemeralVmRuntimeFeatureEntry | null {
  const recipeCheckoutMode = runtime.recipe?.checkoutMode
  const resultCheckoutMode =
    runtime.recipeResult?.schemaVersion === 2 ? runtime.recipeResult.checkoutMode : undefined
  const resultDesktop = runtime.recipeResult?.desktop
  if (!recipeCheckoutMode && !resultCheckoutMode && !resultDesktop) {
    return null
  }
  return {
    id: runtime.id,
    recipeId: runtime.recipeId,
    createdAt: runtime.createdAt,
    ...(recipeCheckoutMode ? { recipeCheckoutMode } : {}),
    ...(resultCheckoutMode ? { resultCheckoutMode } : {}),
    ...(resultDesktop ? { resultDesktop } : {})
  }
}

export function restoreRuntimeFeatureList(
  runtimes: readonly EphemeralVmRuntimeRecord[],
  features: readonly EphemeralVmRuntimeFeatureEntry[]
): EphemeralVmRuntimeRecord[] {
  const byIdentity = new Map<string, EphemeralVmRuntimeFeatureEntry>()
  for (const feature of features) {
    const identity = featureIdentity(feature)
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, feature)
    }
  }
  return runtimes.map((runtime) =>
    restoreRuntimeFeatures(runtime, byIdentity.get(featureIdentity(runtime)))
  )
}

function restoreRuntimeFeatures(
  runtime: EphemeralVmRuntimeRecord,
  feature: EphemeralVmRuntimeFeatureEntry | undefined
): EphemeralVmRuntimeRecord {
  if (!feature) {
    return runtime
  }
  return EphemeralVmRuntimeRecordSchema.parse({
    ...runtime,
    ...(runtime.recipe && feature.recipeCheckoutMode
      ? { recipe: { ...runtime.recipe, checkoutMode: feature.recipeCheckoutMode } }
      : {}),
    ...(runtime.recipeResult && (feature.resultCheckoutMode || feature.resultDesktop)
      ? {
          recipeResult: {
            ...runtime.recipeResult,
            ...(feature.resultCheckoutMode
              ? { schemaVersion: 2, checkoutMode: feature.resultCheckoutMode }
              : {}),
            ...(feature.resultDesktop ? { desktop: feature.resultDesktop } : {})
          }
        }
      : {})
  })
}

/** Checkout modes are fixed for a runtime's life; the desktop may be reconfigured. */
export function runtimeFeaturesEqual(
  left: EphemeralVmRuntimeRecord,
  right: EphemeralVmRuntimeRecord
): boolean {
  return JSON.stringify(checkoutFeatures(left)) === JSON.stringify(checkoutFeatures(right))
}

function checkoutFeatures(
  runtime: EphemeralVmRuntimeRecord
): Omit<EphemeralVmRuntimeFeatureEntry, 'resultDesktop'> | null {
  const { resultDesktop: _resultDesktop, ...checkout } = featureEntryFromRuntime(runtime) ?? {}
  return 'id' in checkout ? checkout : null
}

export function featureIdentity(
  value: Pick<EphemeralVmRuntimeRecord, 'id' | 'recipeId' | 'createdAt'>
): string {
  return `${value.id}\0${value.recipeId}\0${value.createdAt}`
}

function parseFeatureRecords(records: unknown[]): EphemeralVmRuntimeFeatureStoreSnapshot {
  const features = new Map<string, EphemeralVmRuntimeFeatureEntry>()
  const retainedRecords: unknown[] = []
  const identities = new Map<string, string>()
  for (const record of records) {
    const checkout = EphemeralVmRuntimeCheckoutFeatureRecordSchema.safeParse(record)
    const desktop = checkout.success
      ? null
      : EphemeralVmRuntimeDesktopFeatureRecordSchema.safeParse(record)
    const parsed = checkout.success ? checkout.data : desktop?.success ? desktop.data : null
    if (!parsed) {
      retainedRecords.push(record)
      continue
    }
    const identity = featureIdentity(parsed)
    const kindIdentity = `${checkout.success ? 'checkout' : 'desktop'}\0${identity}`
    const serialized = JSON.stringify(parsed)
    const existing = identities.get(kindIdentity)
    if (existing && existing !== serialized) {
      return { writable: false, features: [], retainedRecords: [] }
    }
    if (!existing) {
      identities.set(kindIdentity, serialized)
      features.set(identity, { ...features.get(identity), ...parsed })
    }
  }
  return { writable: true, features: sortRuntimeFeatures([...features.values()]), retainedRecords }
}

function featureEntryToRecords(entry: EphemeralVmRuntimeFeatureEntry): unknown[] {
  const { resultDesktop, ...checkout } = entry
  const { id, recipeId, createdAt } = entry
  return [
    ...(!resultDesktop || checkout.recipeCheckoutMode || checkout.resultCheckoutMode
      ? [checkout]
      : []),
    ...(resultDesktop ? [{ id, recipeId, createdAt, resultDesktop }] : [])
  ]
}

export function sortRuntimeFeatures<T extends { id: string; recipeId: string; createdAt: number }>(
  features: readonly T[]
): T[] {
  return features
    .map((feature) => ({ feature, identity: featureIdentity(feature) }))
    .sort((left, right) => left.identity.localeCompare(right.identity, 'en'))
    .map(({ feature }) => feature)
}

function runtimeFeatureStoreValue(
  snapshot: Extract<EphemeralVmRuntimeFeatureStoreSnapshot, { writable: true }>,
  features: EphemeralVmRuntimeFeatureEntry[]
): { version: 1; records: unknown[] } {
  return {
    version: 1,
    records: [
      ...sortRuntimeFeatures(features).flatMap(featureEntryToRecords),
      ...snapshot.retainedRecords
    ]
  }
}

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
  featureEntryToRecords,
  featureIdentity,
  parseFeatureRecords,
  sortRuntimeFeatures,
  type EphemeralVmRuntimeFeatureEntry
} from './ephemeral-vm-runtime-feature-records'
import {
  EphemeralVmRuntimeRecordSchema,
  type EphemeralVmRuntimeRecord
} from './ephemeral-vm-runtimes'

const EPHEMERAL_VM_RUNTIME_FEATURES_FILE = 'orca-ephemeral-vm-runtime-features.json'
export const MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES = 1024 * 1024

export { featureIdentity, sortRuntimeFeatures, type EphemeralVmRuntimeFeatureEntry }

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
    return parseEphemeralVmRuntimeFeatureStoreText(
      readNodeFileSyncWithinLimit(
        path,
        MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES
      ).buffer.toString('utf8')
    )
  } catch {
    return { writable: false, features: [], retainedRecords: [] }
  }
}

/** The feature store's contents; unreadable text is an unwritable, empty store. */
export function parseEphemeralVmRuntimeFeatureStoreText(
  text: string
): EphemeralVmRuntimeFeatureStoreSnapshot {
  try {
    return parseFeatureRecords(EphemeralVmRuntimeFeatureStoreSchema.parse(JSON.parse(text)).records)
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
): Pick<EphemeralVmRuntimeFeatureEntry, 'recipeCheckoutMode' | 'resultCheckoutMode'> {
  const { recipeCheckoutMode, resultCheckoutMode } = featureEntryFromRuntime(runtime) ?? {}
  return { recipeCheckoutMode, resultCheckoutMode }
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

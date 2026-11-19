import { readNodeFileWithinLimit } from '../../file-content/node-bounded-file-reader'
import {
  compareRuntimeRecords,
  EphemeralVmRuntimeStoreError,
  getEphemeralVmRuntimeStorePath,
  MAX_EPHEMERAL_VM_RUNTIME_STORE_FILE_BYTES
} from './ephemeral-vm-runtime-store'
import {
  featureIdentity,
  getEphemeralVmRuntimeFeatureStorePath,
  MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES,
  parseEphemeralVmRuntimeFeatureStoreText,
  restoreRuntimeFeatureList
} from './ephemeral-vm-runtime-feature-store'
import {
  getEphemeralVmWriteAheadRuntimeStorePath,
  MAX_WRITE_AHEAD_STORE_FILE_BYTES,
  parseWriteAheadRuntimesText
} from './ephemeral-vm-runtime-write-ahead-store'
import {
  EphemeralVmRuntimeStoreSchema,
  type EphemeralVmRuntimeRecord
} from './ephemeral-vm-runtimes'

/** The file's text, or null when it does not exist. */
async function readTextIfPresent(path: string, maxBytes: number): Promise<string | null> {
  try {
    return (await readNodeFileWithinLimit(path, maxBytes)).buffer.toString('utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

const UNREADABLE = Symbol('unreadable')

/**
 * `listEphemeralVmRuntimes` without blocking the main thread: the same records, read-only. It never
 * migrates or hardens the files; the synchronous store owns every write. `complete` is false when
 * the feature store exists but can't be read or holds a record it can't parse, so a record may be
 * missing its desktop.
 */
export async function readEphemeralVmRuntimesAsync(userDataPath: string): Promise<{
  runtimes: EphemeralVmRuntimeRecord[]
  complete: boolean
  /** Each runtime's approved stats command by feature identity; empty when the sidecar is unreadable. */
  statsCommands: ReadonlyMap<string, string>
}> {
  const path = getEphemeralVmRuntimeStorePath(userDataPath)
  const [mainText, featureText, writeAheadText] = await Promise.all([
    readTextIfPresent(path, MAX_EPHEMERAL_VM_RUNTIME_STORE_FILE_BYTES),
    readTextIfPresent(
      getEphemeralVmRuntimeFeatureStorePath(userDataPath),
      MAX_EPHEMERAL_VM_RUNTIME_FEATURE_STORE_FILE_BYTES
    ).catch((): typeof UNREADABLE => UNREADABLE),
    readTextIfPresent(
      getEphemeralVmWriteAheadRuntimeStorePath(userDataPath),
      MAX_WRITE_AHEAD_STORE_FILE_BYTES
    ).catch(() => null)
  ])
  const featureStore =
    featureText === UNREADABLE
      ? null
      : featureText === null
        ? { writable: true, features: [], retainedRecords: [] }
        : parseEphemeralVmRuntimeFeatureStoreText(featureText)
  const features = featureStore?.features ?? []
  let main: EphemeralVmRuntimeRecord[] = []
  if (mainText !== null) {
    try {
      main = restoreRuntimeFeatureList(
        EphemeralVmRuntimeStoreSchema.parse(JSON.parse(mainText)).runtimes,
        features
      )
    } catch {
      throw new EphemeralVmRuntimeStoreError(
        'runtime_error',
        `Could not read Orca ephemeral VM runtimes at ${path}; the file is invalid.`
      )
    }
  }
  let writeAhead: EphemeralVmRuntimeRecord[] = []
  try {
    writeAhead = writeAheadText === null ? [] : parseWriteAheadRuntimesText(writeAheadText)
  } catch {
    // Why: an unreadable sidecar must not hide tracked VMs in the main file.
  }
  const mainIds = new Set(main.map((entry) => entry.id))
  return {
    runtimes: [...main, ...writeAhead.filter((entry) => !mainIds.has(entry.id))].sort(
      compareRuntimeRecords
    ),
    // A record parse dropped (malformed, or from a newer build) may be one runtime's desktop.
    complete: featureStore?.writable === true && featureStore.retainedRecords.length === 0,
    statsCommands: new Map(
      features.flatMap((entry) =>
        entry.recipeStats ? [[featureIdentity(entry), entry.recipeStats] as const] : []
      )
    )
  }
}

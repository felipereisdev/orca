import { z } from 'zod'
import { EphemeralVmRecipeDesktopSchema } from '../ephemeral-vm-recipes/ephemeral-vm-recipes'
import type { EphemeralVmRuntimeRecord } from './ephemeral-vm-runtimes'

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

// The stats step approved with the recipe at creation (its command and the host variables it may
// read); older builds keep it as a retained record.
const EphemeralVmRuntimeStatsFeatureRecordSchema = z
  .object({
    id: z.string().min(1),
    recipeId: z.string().min(1),
    createdAt: z.number().finite(),
    recipeStats: z.string().min(1),
    recipeStatsPassEnv: z.array(z.string()).optional()
  })
  .strict()

const FEATURE_KINDS = [
  ['checkout', EphemeralVmRuntimeCheckoutFeatureRecordSchema],
  ['desktop', EphemeralVmRuntimeDesktopFeatureRecordSchema],
  ['stats', EphemeralVmRuntimeStatsFeatureRecordSchema]
] as const

export type EphemeralVmRuntimeFeatureEntry = z.infer<
  typeof EphemeralVmRuntimeCheckoutFeatureRecordSchema
> &
  Partial<
    Pick<z.infer<typeof EphemeralVmRuntimeDesktopFeatureRecordSchema>, 'resultDesktop'> &
      Pick<
        z.infer<typeof EphemeralVmRuntimeStatsFeatureRecordSchema>,
        'recipeStats' | 'recipeStatsPassEnv'
      >
  >

/** The stats step as approved: only this ever runs, never what orca.yaml says later. */
export type ApprovedRuntimeStats = { command: string; passEnv?: string[] }

export function approvedStatsOf(
  entry: EphemeralVmRuntimeFeatureEntry
): ApprovedRuntimeStats | null {
  return entry.recipeStats
    ? {
        command: entry.recipeStats,
        ...(entry.recipeStatsPassEnv ? { passEnv: entry.recipeStatsPassEnv } : {})
      }
    : null
}

export function approvedStatsFields(
  stats: ApprovedRuntimeStats
): Pick<EphemeralVmRuntimeFeatureEntry, 'recipeStats' | 'recipeStatsPassEnv'> {
  return {
    recipeStats: stats.command,
    ...(stats.passEnv ? { recipeStatsPassEnv: [...stats.passEnv] } : {})
  }
}

export function featureIdentity(
  value: Pick<EphemeralVmRuntimeRecord, 'id' | 'recipeId' | 'createdAt'>
): string {
  return `${value.id}\0${value.recipeId}\0${value.createdAt}`
}

export function sortRuntimeFeatures<T extends { id: string; recipeId: string; createdAt: number }>(
  features: readonly T[]
): T[] {
  return features
    .map((feature) => ({ feature, identity: featureIdentity(feature) }))
    .sort((left, right) => left.identity.localeCompare(right.identity, 'en'))
    .map(({ feature }) => feature)
}

function parseFeatureRecord(
  record: unknown
): { kind: string; entry: EphemeralVmRuntimeFeatureEntry } | null {
  for (const [kind, schema] of FEATURE_KINDS) {
    const parsed = schema.safeParse(record)
    if (parsed.success) {
      return { kind, entry: parsed.data }
    }
  }
  return null
}

export function parseFeatureRecords(records: unknown[]):
  | {
      writable: true
      features: EphemeralVmRuntimeFeatureEntry[]
      retainedRecords: unknown[]
    }
  | { writable: false; features: []; retainedRecords: [] } {
  const features = new Map<string, EphemeralVmRuntimeFeatureEntry>()
  const retainedRecords: unknown[] = []
  const identities = new Map<string, string>()
  for (const record of records) {
    const parsed = parseFeatureRecord(record)
    if (!parsed) {
      retainedRecords.push(record)
      continue
    }
    const identity = featureIdentity(parsed.entry)
    const kindIdentity = `${parsed.kind}\0${identity}`
    const serialized = JSON.stringify(parsed.entry)
    const existing = identities.get(kindIdentity)
    if (existing && existing !== serialized) {
      return { writable: false, features: [], retainedRecords: [] }
    }
    if (!existing) {
      identities.set(kindIdentity, serialized)
      features.set(identity, { ...features.get(identity), ...parsed.entry })
    }
  }
  return { writable: true, features: sortRuntimeFeatures([...features.values()]), retainedRecords }
}

export function featureEntryToRecords(entry: EphemeralVmRuntimeFeatureEntry): unknown[] {
  const { resultDesktop, recipeStats, recipeStatsPassEnv, ...checkout } = entry
  const { id, recipeId, createdAt } = entry
  const hasCheckoutMode = Boolean(checkout.recipeCheckoutMode || checkout.resultCheckoutMode)
  return [
    ...(hasCheckoutMode || (!resultDesktop && !recipeStats) ? [checkout] : []),
    ...(resultDesktop ? [{ id, recipeId, createdAt, resultDesktop }] : []),
    ...(recipeStats
      ? [
          {
            id,
            recipeId,
            createdAt,
            recipeStats,
            ...(recipeStatsPassEnv ? { recipeStatsPassEnv } : {})
          }
        ]
      : [])
  ]
}

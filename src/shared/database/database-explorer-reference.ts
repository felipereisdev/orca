import * as z from 'zod'
export const databaseExplorerReferenceSchema = z.object({
  connectionId: z.string().uuid(),
  controllerRuntimeId: z.string().min(1).max(1024)
})
export const databaseExplorerEntitySchema = z
  .string()
  .max(1280)
  .refine((value) => {
    try {
      return databaseExplorerReferenceSchema.safeParse(JSON.parse(value)).success
    } catch {
      return false
    }
  })
export const databaseExplorerReference = (entityId: string) =>
  databaseExplorerReferenceSchema.parse(JSON.parse(databaseExplorerEntitySchema.parse(entityId)))

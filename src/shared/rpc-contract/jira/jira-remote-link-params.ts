import { z } from 'zod'

export const AddRemoteLink = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]*-\d+$/i),
  siteId: z.string().trim().min(1),
  url: z.string().max(8192),
  title: z.string().max(1000).optional()
})

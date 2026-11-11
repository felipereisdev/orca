import { z } from 'zod'

export const ClaudeAccountIdParam = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-zA-Z0-9_-]+$/)

export const AccountHome = z
  .object({
    variable: z.enum(['CLAUDE_CONFIG_DIR', 'CODEX_HOME']),
    path: z.string().min(1).max(4096)
  })
  .strict()

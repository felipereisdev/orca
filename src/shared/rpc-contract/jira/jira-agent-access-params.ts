import { z } from 'zod'

const target = { key: z.string().trim().min(1), siteId: z.string().trim().min(1) }
export const AgentIssueContext = z.object({
  ...target,
  comments: z.boolean().optional(),
  attachments: z.boolean().optional(),
  links: z.boolean().optional(),
  subtasks: z.boolean().optional()
})
export const AgentAttachmentRead = z.object({
  ...target,
  id: z.string().min(1),
  offset: z
    .number()
    .int()
    .min(0)
    .max(20 * 1024 * 1024)
})
export const AgentSearchIssues = z.object({
  siteId: target.siteId,
  jql: z.string().max(20_000).optional(),
  filter: z.enum(['assigned', 'reported', 'all', 'done']).optional(),
  limit: z.number().int().min(1).max(51)
})
export const AgentCurrentIssue = z.object({
  cwd: z.string().optional(),
  remote: z.boolean().optional(),
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional()
})

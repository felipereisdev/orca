import { z } from 'zod'

const DesktopPort = z.number().int().min(1).max(65_535)

// Schema messages never echo values: the password and launcher token must not reach errors.
export const DesktopConfigureParams = z.object({
  host: z.string().min(1, 'Missing required host'),
  port: DesktopPort,
  password: z.string().min(1, 'Missing required password'),
  launcher: z
    .object({
      port: DesktopPort,
      token: z.string().min(1, 'Missing required launcher token')
    })
    .optional()
})

export const DesktopStatusParams = z.object({})

export const DesktopControlSetParams = z.object({
  owner: z.enum(['agent', 'user']),
  viewerId: z.string().min(1, 'Missing required --viewer-id')
})

export const DesktopViewerParams = z.object({
  viewerId: z.string().min(1, 'Missing required --viewer-id')
})

export const DesktopViewerUnsubscribeParams = z.object({
  subscriptionId: z.string().min(1, 'Missing required --subscription-id')
})

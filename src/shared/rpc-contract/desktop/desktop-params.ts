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

export const DESKTOP_TYPE_MAX_CHARS = 10_000

const DesktopCoordinate = (flag: string) =>
  z
    .number({ error: `Missing required ${flag}` })
    .int(`${flag} must be an integer`)
    .min(0, `${flag} must be at least 0`)

export const DesktopScreenshotParams = z.object({
  out: z.string().min(1, '--out must not be empty').optional()
})

export const DesktopMoveParams = z.object({
  x: DesktopCoordinate('--x'),
  y: DesktopCoordinate('--y')
})

export const DesktopClickParams = z.object({
  x: DesktopCoordinate('--x'),
  y: DesktopCoordinate('--y'),
  button: z.enum(['left', 'middle', 'right']).optional(),
  double: z.boolean().optional()
})

export const DesktopDragParams = z.object({
  fromX: DesktopCoordinate('--from-x'),
  fromY: DesktopCoordinate('--from-y'),
  toX: DesktopCoordinate('--to-x'),
  toY: DesktopCoordinate('--to-y')
})

export const DesktopScrollParams = z.object({
  x: DesktopCoordinate('--x'),
  y: DesktopCoordinate('--y'),
  dy: z.number({ error: 'Missing required --dy' }).int('--dy must be an integer')
})

export const DesktopTypeParams = z.object({
  text: z
    .string({ error: 'Missing required --text' })
    .min(1, 'Missing required --text')
    .max(DESKTOP_TYPE_MAX_CHARS, `--text must be at most ${DESKTOP_TYPE_MAX_CHARS} characters`)
})

export const DesktopKeyParams = z.object({
  combo: z.string({ error: 'Missing required --combo' }).min(1, 'Missing required --combo')
})

export const DesktopRunParams = z.object({
  argv: z.array(z.string()).min(1, 'Missing required command'),
  cwd: z.string().min(1, 'cwd must not be empty').optional(),
  env: z.record(z.string(), z.string()).optional()
})

export const DesktopRunUnsubscribeParams = z.object({
  subscriptionId: z.string().min(1, 'Missing required --subscription-id')
})

/** `received`: stdout/stderr events the client has taken so far (cumulative). */
export const DesktopRunAckParams = z.object({
  subscriptionId: z.string().min(1, 'Missing required --subscription-id'),
  received: z.number().int().min(0, 'received must be at least 0')
})

const MiB = 1024 * 1024
export const DESKTOP_RECORD_DEFAULT_MAX_SECONDS = 600
export const DESKTOP_RECORD_DEFAULT_MAX_BYTES = 200 * MiB

export const DesktopRecordStartParams = z.object({
  maxSeconds: z
    .number()
    .int('--max-seconds must be an integer')
    .min(1, '--max-seconds must be at least 1')
    .max(3600, '--max-seconds must be at most 3600')
    .optional(),
  maxBytes: z
    .number()
    .int('--max-bytes must be an integer')
    .min(MiB, '--max-bytes must be at least 1 MB')
    .max(2 * 1024 * MiB, '--max-bytes must be at most 2 GB')
    .optional()
})

export const DesktopRecordStopParams = z.object({})

export const DesktopRecordingsListParams = z.object({})

export const DesktopEventsParams = z.object({})

export const DesktopEventsUnsubscribeParams = z.object({
  subscriptionId: z.string().min(1, 'Missing required --subscription-id')
})

import { resolve } from 'node:path'
import type { CommandHandler } from '../dispatch/dispatch'
import {
  getOptionalNonNegativeIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../arguments/flags'
import { getFlagOrStdinPayload } from '../arguments/flag-or-stdin-payload'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { callDesktop } from './desktop-rpc'
import { runDesktopRun } from './desktop-run-command'

type DesktopStatus = {
  state: string
  reason?: string
  owner: string
  width?: number
  height?: number
  recording: boolean
}
type Recording = { id: string; path: string; seconds: number; bytes: number; stopped: string }
type RecordingEntry = { id: string; path: string; bytes: number; createdAt: string }

const BUTTONS = ['left', 'middle', 'right'] as const
// Typing is paced at about 5 ms per character, so 10 000 characters take about 50 s.
const typeTimeoutMs = (text: string): number => Math.max(60_000, 30_000 + text.length * 10)

function integerFlag(flags: Map<string, string | boolean>, name: string): number {
  const value = Number(getRequiredStringFlag(flags, name))
  if (!Number.isInteger(value)) {
    throw new RuntimeClientError('invalid_argument', `--${name} must be an integer`)
  }
  return value
}

function formatStatus(status: DesktopStatus): string {
  return [
    `State: ${status.state}${status.reason ? ` (${status.reason})` : ''}`,
    `Control: ${status.owner}`,
    status.width !== undefined && status.height !== undefined
      ? `Size: ${status.width}x${status.height}`
      : null,
    `Recording: ${status.recording ? 'yes' : 'no'}`
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/** The line the agent pastes into its reply so the chat shows the video. */
export function recordingChatMarkdown(path: string): string {
  return `![Gravação do teste](${path})`
}

function formatRecording(recording: Recording): string {
  return [
    `Recorded ${recording.seconds} s (${recording.bytes} bytes) to ${recording.path}`,
    recording.stopped === 'limit' ? 'The recording had already stopped at its limit.' : null,
    'Paste this line into your reply:',
    recordingChatMarkdown(recording.path)
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export const DESKTOP_HANDLERS: Record<string, CommandHandler> = {
  'desktop status': async ({ client, json }) => {
    printResult(await callDesktop<DesktopStatus>(client, 'desktop.status', {}), json, formatStatus)
  },
  'desktop screenshot': async ({ flags, client, cwd, json }) => {
    const out = getOptionalStringFlag(flags, 'out')
    const result = await callDesktop<{ path: string; width: number; height: number }>(
      client,
      'desktop.screenshot',
      out === undefined ? {} : { out: resolve(cwd, out) }
    )
    printResult(
      result,
      json,
      (shot) => `Saved ${shot.width}x${shot.height} screenshot: ${shot.path}`
    )
  },
  'desktop move': async ({ flags, client, json }) => {
    const x = integerFlag(flags, 'x')
    const y = integerFlag(flags, 'y')
    const result = await callDesktop<DesktopStatus>(client, 'desktop.move', { x, y })
    printResult(result, json, () => `Moved the pointer to ${x},${y}.`)
  },
  'desktop click': async ({ flags, client, json }) => {
    const x = integerFlag(flags, 'x')
    const y = integerFlag(flags, 'y')
    const button = getOptionalStringFlag(flags, 'button')
    if (button !== undefined && !BUTTONS.some((name) => name === button)) {
      throw new RuntimeClientError('invalid_argument', '--button must be left, middle or right')
    }
    const double = flags.get('double') === true
    const result = await callDesktop<DesktopStatus>(client, 'desktop.click', {
      x,
      y,
      ...(button === undefined ? {} : { button }),
      ...(double ? { double } : {})
    })
    printResult(
      result,
      json,
      () => `${double ? 'Double-clicked' : 'Clicked'} ${button ?? 'left'} at ${x},${y}.`
    )
  },
  'desktop drag': async ({ flags, client, json }) => {
    const params = {
      fromX: integerFlag(flags, 'from-x'),
      fromY: integerFlag(flags, 'from-y'),
      toX: integerFlag(flags, 'to-x'),
      toY: integerFlag(flags, 'to-y')
    }
    const result = await callDesktop<DesktopStatus>(client, 'desktop.drag', params)
    printResult(
      result,
      json,
      () => `Dragged from ${params.fromX},${params.fromY} to ${params.toX},${params.toY}.`
    )
  },
  'desktop scroll': async ({ flags, client, json }) => {
    const x = integerFlag(flags, 'x')
    const y = integerFlag(flags, 'y')
    const dy = integerFlag(flags, 'dy')
    const result = await callDesktop<DesktopStatus>(client, 'desktop.scroll', { x, y, dy })
    printResult(result, json, () => `Scrolled ${dy} at ${x},${y}.`)
  },
  'desktop type': async ({ flags, client, json }) => {
    const text = await getFlagOrStdinPayload(flags, 'text')
    const result = await callDesktop<DesktopStatus>(
      client,
      'desktop.type',
      { text },
      { timeoutMs: typeTimeoutMs(text) }
    )
    printResult(result, json, () => `Typed ${text.length} characters.`)
  },
  'desktop key': async ({ flags, client, json }) => {
    const combo = getRequiredStringFlag(flags, 'combo')
    const result = await callDesktop<DesktopStatus>(client, 'desktop.key', { combo })
    printResult(result, json, () => `Pressed ${combo}.`)
  },
  'desktop run': async ({ client, cwd, json, trailingArgs }) => {
    if (!trailingArgs || trailingArgs.length === 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Missing command: use orca desktop run -- <command...>'
      )
    }
    process.exitCode = await runDesktopRun({ client, argv: trailingArgs, cwd, json })
  },
  'desktop record start': async ({ flags, client, json }) => {
    const maxSeconds = getOptionalNonNegativeIntegerFlag(flags, 'max-seconds')
    const maxBytes = getOptionalNonNegativeIntegerFlag(flags, 'max-bytes')
    const result = await callDesktop<{ id: string; path: string }>(client, 'desktop.record.start', {
      ...(maxSeconds === undefined ? {} : { maxSeconds }),
      ...(maxBytes === undefined ? {} : { maxBytes })
    })
    printResult(
      result,
      json,
      (recording) =>
        `Recording the desktop to ${recording.path}\nStop it with: orca desktop record stop`
    )
  },
  'desktop record stop': async ({ client, json }) => {
    printResult(
      await callDesktop<Recording>(client, 'desktop.record.stop', {}),
      json,
      formatRecording
    )
  },
  'desktop recordings': async ({ client, json }) => {
    const result = await callDesktop<{ recordings: RecordingEntry[] } | RecordingEntry[]>(
      client,
      'desktop.recordings.list',
      {}
    )
    printResult(result, json, (value) => {
      const recordings = Array.isArray(value) ? value : value.recordings
      return recordings.length === 0
        ? 'No desktop recordings.'
        : recordings
            .map((entry) => `${entry.createdAt}  ${entry.bytes} bytes  ${entry.path}`)
            .join('\n')
    })
  }
}

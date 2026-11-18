import { DesktopError } from './desktop-errors'
import { keysymsFor, keysymsForText } from './desktop-keysyms'
import { keyEventMessage, pointerEventMessage } from './desktop-rfb-input'

/** Gap between input steps, so X clients see separate events (as xdotool's default delay). */
export const AGENT_INPUT_STEP_MS = 5
const DRAG_STEPS = 5
const MAX_SCROLL_STEPS = 100

const BUTTON_MASKS = { left: 1, middle: 2, right: 4 } as const
const SCROLL_UP_MASK = 8
const SCROLL_DOWN_MASK = 16

export type DesktopButton = keyof typeof BUTTON_MASKS
export type DesktopPoint = { x: number; y: number }

/** Where agent input goes. `send` checks ownership and readiness before every event. */
export type AgentInputSink = {
  send(message: Buffer): void
  size(): { width: number; height: number }
}

function pace(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, AGENT_INPUT_STEP_MS))
}

function checkedPoint(sink: AgentInputSink, point: DesktopPoint): DesktopPoint {
  const { width, height } = sink.size()
  const { x, y } = point
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new DesktopError('desktop_invalid_input', `point must be inside ${width}x${height}`)
  }
  return point
}

function sendChord(sink: AgentInputSink, keysyms: number[]): void {
  for (const keysym of keysyms) {
    sink.send(keyEventMessage(true, keysym))
  }
  for (const keysym of keysyms.toReversed()) {
    sink.send(keyEventMessage(false, keysym))
  }
}

export function agentMove(sink: AgentInputSink, point: DesktopPoint): void {
  const { x, y } = checkedPoint(sink, point)
  sink.send(pointerEventMessage(0, x, y))
}

export async function agentClick(
  sink: AgentInputSink,
  point: DesktopPoint,
  opts: { button: DesktopButton; double?: boolean }
): Promise<void> {
  const { x, y } = checkedPoint(sink, point)
  const mask = BUTTON_MASKS[opts.button]
  if (mask === undefined) {
    throw new DesktopError('desktop_invalid_input', 'button must be left, middle or right')
  }
  sink.send(pointerEventMessage(0, x, y))
  for (let click = 0; click < (opts.double ? 2 : 1); click++) {
    if (click > 0) {
      await pace()
    }
    sink.send(pointerEventMessage(mask, x, y))
    sink.send(pointerEventMessage(0, x, y))
  }
}

export async function agentDrag(
  sink: AgentInputSink,
  from: DesktopPoint,
  to: DesktopPoint
): Promise<void> {
  const start = checkedPoint(sink, from)
  const end = checkedPoint(sink, to)
  sink.send(pointerEventMessage(0, start.x, start.y))
  sink.send(pointerEventMessage(BUTTON_MASKS.left, start.x, start.y))
  let last = start
  for (let step = 1; step <= DRAG_STEPS; step++) {
    await pace()
    const next = {
      x: Math.round(start.x + ((end.x - start.x) * step) / DRAG_STEPS),
      y: Math.round(start.y + ((end.y - start.y) * step) / DRAG_STEPS)
    }
    try {
      // The desktop may have shrunk since the drag started.
      checkedPoint(sink, next)
    } catch (error) {
      // Lost control is released by the handover; a shrunken desktop needs our own button-up.
      if (error instanceof DesktopError && error.code === 'desktop_invalid_input') {
        sink.send(pointerEventMessage(0, last.x, last.y))
      }
      throw error
    }
    sink.send(pointerEventMessage(BUTTON_MASKS.left, next.x, next.y))
    last = next
  }
  sink.send(pointerEventMessage(0, end.x, end.y))
}

export async function agentScroll(
  sink: AgentInputSink,
  point: DesktopPoint,
  opts: { dy: number }
): Promise<void> {
  const { x, y } = checkedPoint(sink, point)
  const { dy } = opts
  if (!Number.isInteger(dy) || dy === 0 || Math.abs(dy) > MAX_SCROLL_STEPS) {
    throw new DesktopError(
      'desktop_invalid_input',
      `dy must be a non-zero integer up to ±${MAX_SCROLL_STEPS}`
    )
  }
  const mask = dy < 0 ? SCROLL_UP_MASK : SCROLL_DOWN_MASK
  sink.send(pointerEventMessage(0, x, y))
  for (let step = 0; step < Math.abs(dy); step++) {
    if (step > 0) {
      await pace()
    }
    sink.send(pointerEventMessage(mask, x, y))
    sink.send(pointerEventMessage(0, x, y))
  }
}

export async function agentType(sink: AgentInputSink, text: string): Promise<void> {
  const chords = keysymsForText(text)
  for (const [index, chord] of chords.entries()) {
    if (index > 0) {
      await pace()
    }
    sendChord(sink, chord)
  }
}

export function agentKey(sink: AgentInputSink, combo: string): void {
  sendChord(sink, keysymsFor(combo))
}

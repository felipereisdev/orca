import type { DesktopFrame } from './desktop-control-connection'

/** The fixed size every frame of a recording is fitted to. */
export type RecordingCanvas = { width: number; height: number; blank?: Buffer }

/** The starting size rounded up to even: yuv420p subsamples chroma 2x2 and libx264 refuses odd sizes. */
export function evenCanvas(frame: DesktopFrame): RecordingCanvas {
  return { width: frame.width + (frame.width % 2), height: frame.height + (frame.height % 2) }
}

/** Copies `frame` onto the canvas: cropped, and padded with opaque black. */
export function fitFrame(canvas: RecordingCanvas, frame: DesktopFrame): Buffer {
  const rgba = frame.rgba()
  if (frame.width === canvas.width && frame.height === canvas.height) {
    return rgba
  }
  if (!canvas.blank) {
    canvas.blank = Buffer.alloc(canvas.width * canvas.height * 4)
    for (let alpha = 3; alpha < canvas.blank.length; alpha += 4) {
      canvas.blank[alpha] = 255
    }
  }
  const fitted = Buffer.from(canvas.blank)
  const rowBytes = Math.min(frame.width, canvas.width) * 4
  const rows = Math.min(frame.height, canvas.height)
  for (let y = 0; y < rows; y++) {
    const from = y * frame.width * 4
    rgba.copy(fitted, y * canvas.width * 4, from, from + rowBytes)
  }
  return fitted
}

/** Which pixels of a w×h frame have arrived since it was (re)sized; each pixel counts once. */
export class DesktopFrameCoverage {
  private readonly covered: Uint8Array
  private remaining: number

  constructor(
    private readonly width: number,
    height: number
  ) {
    this.covered = new Uint8Array(width * height)
    this.remaining = width * height
  }

  get complete(): boolean {
    return this.remaining === 0
  }

  /** The rect must lie inside the frame (callers bounds-check it before applying pixels). */
  mark(x: number, y: number, width: number, height: number): void {
    for (let row = y; row < y + height; row++) {
      const start = row * this.width + x
      for (let index = start; index < start + width; index++) {
        if (this.covered[index] === 0) {
          this.covered[index] = 1
          this.remaining--
        }
      }
    }
  }
}

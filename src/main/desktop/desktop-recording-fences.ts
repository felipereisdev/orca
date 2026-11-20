export const DESKTOP_RECORDING_FENCE_MS = 10 * 60_000

export class DesktopRecordingFences {
  readonly #expiresAt = new Map<string | undefined, number>()

  constructor(private readonly now: () => number) {}

  hold(fenceId: string | undefined): void {
    this.removeExpired()
    this.#expiresAt.set(fenceId, this.now() + DESKTOP_RECORDING_FENCE_MS)
  }

  release(fenceId: string): void {
    this.#expiresAt.delete(fenceId)
  }

  clear(): void {
    this.#expiresAt.clear()
  }

  held(): boolean {
    this.removeExpired()
    return this.#expiresAt.size !== 0
  }

  private removeExpired(): void {
    const now = this.now()
    for (const [id, deadline] of this.#expiresAt) {
      if (now >= deadline) {
        this.#expiresAt.delete(id)
      }
    }
  }
}

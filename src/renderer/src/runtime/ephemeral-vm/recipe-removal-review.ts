import type { RecipeRemovalResult } from './recipe-removal-preflights'

/** A removal waiting for the user to see what it would lose. */
export type RecipeRemovalReview = {
  results: RecipeRemovalResult[]
  /** One workspace: the review can copy its recordings before removing. */
  single: boolean
  settle: (remove: boolean) => void
}

let current: RecipeRemovalReview | null = null
const listeners = new Set<() => void>()

function publish(next: RecipeRemovalReview | null): void {
  current = next
  for (const listener of listeners) {
    listener()
  }
}

export function getRecipeRemovalReview(): RecipeRemovalReview | null {
  return current
}

export function subscribeRecipeRemovalReview(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shows the review dialog; resolves true when the user removes, false when they cancel. */
export function requestRecipeRemovalReview(
  results: RecipeRemovalResult[],
  single: boolean
): Promise<boolean> {
  // A review still open belongs to an earlier removal; cancel it rather than lose its answer.
  current?.settle(false)
  return new Promise((resolve) => {
    const review: RecipeRemovalReview = {
      results,
      single,
      settle: (remove) => {
        if (current === review) {
          publish(null)
        }
        resolve(remove)
      }
    }
    publish(review)
  })
}

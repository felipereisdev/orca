import type { RecipeRemovalAcks, RecipeRemovalResult } from './recipe-removal-preflights'
import { revokeRecipeRemovalAck, revokeRecipeRemovalAcks } from './recipe-removal-preflights'

/** A removal waiting for the user to see what it would lose. */
export type RecipeRemovalReview = {
  results: RecipeRemovalResult[]
  /** One workspace: the review can copy its recordings before removing. */
  single: boolean
  trackCopyAck: (ack: string) => void
  /** The decided acks, or null for cancel (which revokes every ack this review showed). */
  settle: (acks: RecipeRemovalAcks | null) => void
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

/** Shows the review dialog; resolves the acks to remove with, or null when the user cancels. */
export function requestRecipeRemovalReview(
  results: RecipeRemovalResult[],
  single: boolean
): Promise<RecipeRemovalAcks | null> {
  // A review still open belongs to an earlier removal; cancel it rather than lose its answer.
  current?.settle(null)
  return new Promise((resolve) => {
    let decision: RecipeRemovalAcks | null | undefined
    const copyAcks = new Set<string>()
    const review: RecipeRemovalReview = {
      results,
      single,
      trackCopyAck: (ack) => {
        if (decision === null) {
          revokeRecipeRemovalAck(ack)
        } else if (decision === undefined) {
          copyAcks.add(ack)
        }
      },
      settle: (acks) => {
        if (decision !== undefined) {
          return
        }
        decision = acks
        if (!acks) {
          revokeRecipeRemovalAcks(results)
          copyAcks.forEach(revokeRecipeRemovalAck)
        }
        if (current === review) {
          publish(null)
        }
        resolve(acks)
      }
    }
    publish(review)
  })
}

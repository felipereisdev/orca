/**
 * A delete dialog's removal session, offered to the removal its decision starts. The removal flow
 * takes it synchronously when it begins, then owns it: each store removal adopts its claim in this
 * session, and the flow ends the session when it finishes. A callback that stops first (changed
 * targets, a child detach still pending) takes nothing, so the dialog revokes the session on close.
 */
let offered: string | undefined

/** Runs the dialog's removal callback; true when a removal flow took the session over. */
export function handOffRecipeRemovalSession(sessionId: string, run: () => void): boolean {
  offered = sessionId
  let taken = false
  try {
    run()
  } finally {
    // Whatever wasn't taken during the call stays with the dialog.
    taken = offered === undefined
    offered = undefined
  }
  return taken
}

/** At the start of a removal flow: the dialog session it now owns, if one was offered. */
export function takeRecipeRemovalSession(): string | undefined {
  const sessionId = offered
  offered = undefined
  return sessionId
}

/** Closing the dialog, or the flow that took the session finishing: unadopted claims end. */
export function endRecipeRemovalSession(sessionId: string): void {
  void window.api.ephemeralVm.revokeRemovalSession({ sessionId }).catch(() => {})
}

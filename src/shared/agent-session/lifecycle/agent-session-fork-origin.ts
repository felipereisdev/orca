export type AgentSessionForkedFrom = {
  sessionId: string
  /** The source response whose turn the fork copied through. */
  itemId: string
  /** Where the inherited history ends in this chat's own journal. */
  childBoundary: { kind: 'item'; itemId: string } | { kind: 'start' }
}

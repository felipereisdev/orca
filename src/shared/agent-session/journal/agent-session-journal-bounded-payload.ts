export type AgentJournalBoundedPayload = {
  head: string
  /** Byte length of the ORIGINAL payload, not of `head`. */
  byteLength: number
  /** sha256 of the original payload, for identification only. */
  digest: string
  truncated: boolean
}

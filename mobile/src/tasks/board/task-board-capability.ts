import { MOBILE_TASK_BOARD_RUNTIME_CAPABILITY } from '../../../../src/shared/mobile-runtime-capabilities'
import { readHostStatusReply } from '../../query/host-status-query'
import { readProbedHostCapabilities } from '../../transport/connection/host-status-probe-operations'
import { isMobileMethodUnavailableError } from '../../transport/rpc/mobile-method-unavailable'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { RpcResponse } from '../../transport/rpc/rpc-wire-types'

/** A host without the five taskBoard.* methods; the screen shows its own localized update hint. */
export class TaskBoardUnsupportedError extends Error {
  constructor() {
    super('host has no taskBoard methods')
    this.name = 'TaskBoardUnsupportedError'
  }
}

/** Throws TaskBoardUnsupportedError for a host that never announced the board; an unreadable status lets the read decide. */
export async function assertTaskBoardSupported(client: RpcClient): Promise<void> {
  const capabilities = readProbedHostCapabilities(await readHostStatusReply(client))
  if (capabilities && !capabilities.includes(MOBILE_TASK_BOARD_RUNTIME_CAPABILITY)) {
    throw new TaskBoardUnsupportedError()
  }
}

// Old hosts may refuse at the mobile allowlist before dispatch; either refusal means no board.
export function isTaskBoardUnavailableReply(reply: RpcResponse): boolean {
  return !reply.ok && isMobileMethodUnavailableError(reply.error.code, reply.error.message)
}

import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { DesktopError } from '../../../../desktop/desktop-errors'
import { DesktopRunSessions } from '../../../../desktop/desktop-run-sessions'
import {
  DESKTOP_RUN_READ_DEFAULT_WAIT_MS,
  DesktopRunKillParams,
  DesktopRunReadParams,
  DesktopRunStartParams
} from '../../../../../shared/rpc-contract/desktop/desktop-params'
import type { RpcCallerIdentity } from '../../callers/rpc-caller-identity'
import { defineMethod, type RpcContext } from '../../core'

/** The server-stamped caller a run is bound to; an agent and a person on one device differ. */
function runOwner({ caller }: Pick<RpcContext, 'caller'>): string {
  const identity: RpcCallerIdentity | undefined = caller
  if (!identity) {
    throw new DesktopError('desktop_run_unavailable', 'caller_identity_required')
  }
  switch (identity.kind) {
    case 'local-cli':
      return 'local-cli'
    case 'desktop':
      return 'desktop'
    case 'paired-device':
      return `device:${identity.agent ? 'agent' : 'person'}:${identity.deviceId}`
  }
}

/**
 * Starts GUI programs through the in-environment launcher, which runs them as user `gui` (the
 * agent user has no display). Unary calls only, so the local CLI socket can drive them:
 * `desktop.run.start` names the run, `desktop.run.read` long-polls its output and exit, and
 * `desktop.run.kill` kills its process group.
 */
export function createDesktopRunMethods(
  getBroker: () => DesktopBroker,
  sessions: DesktopRunSessions = new DesktopRunSessions()
) {
  return [
    defineMethod({
      name: 'desktop.run.start',
      permission: 'workspace',
      params: DesktopRunStartParams,
      handler: async (params, ctx) => {
        const owner = runOwner(ctx)
        const broker = getBroker()
        const endpoint = broker.launcherEndpoint()
        if (!endpoint) {
          throw new DesktopError('desktop_run_unavailable')
        }
        // Programs already running keep going; new ones wait until the agent has control again.
        if (broker.status().owner === 'user') {
          throw new DesktopError('desktop_user_in_control')
        }
        return { runId: await sessions.start(endpoint, params, owner) }
      }
    }),
    defineMethod({
      name: 'desktop.run.read',
      permission: 'workspace',
      params: DesktopRunReadParams,
      handler: async (params, ctx) =>
        sessions.read(
          params.runId,
          runOwner(ctx),
          params.cursor,
          params.waitMs ?? DESKTOP_RUN_READ_DEFAULT_WAIT_MS,
          ctx.signal
        )
    }),
    defineMethod({
      name: 'desktop.run.kill',
      permission: 'workspace',
      params: DesktopRunKillParams,
      handler: async (params, ctx) => sessions.kill(params.runId, runOwner(ctx))
    })
  ]
}

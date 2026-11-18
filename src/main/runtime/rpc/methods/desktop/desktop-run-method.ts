import { randomUUID } from 'node:crypto'
import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { DesktopError } from '../../../../desktop/desktop-errors'
import { runOnLauncher } from '../../../../desktop/desktop-launcher-client'
import {
  DesktopRunParams,
  DesktopRunUnsubscribeParams
} from '../../../../../shared/rpc-contract/desktop/desktop-params'
import { defineMethod, defineStreamingMethod } from '../../core'

const RUN_SUBSCRIPTION_PREFIX = 'desktop-run:'

/**
 * Starts a GUI program through the in-environment launcher, which runs it as user `desktop`
 * (the agent user has no display). Streams `ready`, then `{stdout}`/`{stderr}`, then `{exit}`;
 * unsubscribing, aborting or the connection closing kills the program's process group.
 */
export function createDesktopRunMethods(getBroker: () => DesktopBroker) {
  return [
    defineStreamingMethod({
      name: 'desktop.run',
      permission: 'workspace',
      params: DesktopRunParams,
      handler: async (params, { runtime, connectionId, signal }, emit) => {
        const endpoint = getBroker().launcherEndpoint()
        if (!endpoint) {
          throw new DesktopError('desktop_run_unavailable')
        }
        const subscriptionId = `${RUN_SUBSCRIPTION_PREFIX}${randomUUID()}`
        const cancel = new AbortController()
        const onAbort = (): void => cancel.abort()
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) {
          cancel.abort()
        }
        runtime.registerSubscriptionCleanup(subscriptionId, () => cancel.abort(), connectionId)
        try {
          const exit = await runOnLauncher(endpoint, params, {
            signal: cancel.signal,
            onStarted: () => emit({ type: 'ready', subscriptionId }),
            onOutput: (stream, data) => emit({ [stream]: data })
          })
          if (exit !== undefined) {
            emit({ exit })
          } else if (!signal?.aborted) {
            emit({ type: 'end', subscriptionId })
          }
        } finally {
          signal?.removeEventListener('abort', onAbort)
          runtime.cleanupSubscription(subscriptionId)
        }
      }
    }),
    defineMethod({
      name: 'desktop.run.unsubscribe',
      permission: 'workspace',
      params: DesktopRunUnsubscribeParams,
      handler: async (params, { runtime, connectionId }) => {
        // Only runs this connection started: this must not end other subscriptions or runs.
        if (!params.subscriptionId.startsWith(RUN_SUBSCRIPTION_PREFIX) || !connectionId) {
          return { unsubscribed: false }
        }
        return {
          unsubscribed: runtime.cleanupSubscriptionIfOwnedByConnection(
            params.subscriptionId,
            connectionId
          )
        }
      }
    })
  ]
}

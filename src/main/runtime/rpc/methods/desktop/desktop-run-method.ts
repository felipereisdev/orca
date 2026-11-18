import { randomUUID } from 'node:crypto'
import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { DesktopError } from '../../../../desktop/desktop-errors'
import { runOnLauncher, type LauncherRunFlow } from '../../../../desktop/desktop-launcher-client'
import {
  DesktopRunAckParams,
  DesktopRunParams,
  DesktopRunUnsubscribeParams
} from '../../../../../shared/rpc-contract/desktop/desktop-params'
import { defineMethod, defineStreamingMethod } from '../../core'

const RUN_SUBSCRIPTION_PREFIX = 'desktop-run:'
/** Output chars sent but not yet acknowledged before the launcher stops being read. */
const MAX_UNACKED_OUTPUT_CHARS = 1024 * 1024

/** Output credit of one run: reading pauses past the bound and resumes as acks arrive. */
class RunOutputCredit {
  #sent = 0
  #acked = 0
  #flow: LauncherRunFlow | undefined
  #paused = false

  constructor(readonly connectionId: string | undefined) {}

  start(flow: LauncherRunFlow): void {
    this.#flow = flow
  }

  sent(chars: number): void {
    this.#sent += chars
    if (!this.#paused && this.#sent - this.#acked > MAX_UNACKED_OUTPUT_CHARS) {
      this.#paused = true
      this.#flow?.pause()
    }
  }

  ack(received: number): void {
    // Cumulative and idempotent; never past what was sent.
    this.#acked = Math.max(this.#acked, Math.min(received, this.#sent))
    if (this.#paused && this.#sent - this.#acked <= MAX_UNACKED_OUTPUT_CHARS) {
      this.#paused = false
      this.#flow?.resume()
    }
  }
}

/**
 * Starts a GUI program through the in-environment launcher, which runs it as user `desktop`
 * (the agent user has no display). Streams `ready`, then `{stdout}`/`{stderr}`, then `{exit}`;
 * unsubscribing, aborting or the connection closing kills the program's process group.
 * Clients acknowledge output with `desktop.run.ack`: past 1 MiB unacknowledged chars the launcher
 * is no longer read, so a slow client holds back the program instead of growing memory.
 */
export function createDesktopRunMethods(getBroker: () => DesktopBroker) {
  const credits = new Map<string, RunOutputCredit>()
  return [
    defineStreamingMethod({
      name: 'desktop.run',
      permission: 'workspace',
      params: DesktopRunParams,
      handler: async (params, { runtime, connectionId, signal }, emit) => {
        const broker = getBroker()
        const endpoint = broker.launcherEndpoint()
        if (!endpoint) {
          throw new DesktopError('desktop_run_unavailable')
        }
        // Programs already running keep going; new ones wait until the agent has control again.
        if (broker.status().owner === 'user') {
          throw new DesktopError('desktop_user_in_control')
        }
        const subscriptionId = `${RUN_SUBSCRIPTION_PREFIX}${randomUUID()}`
        const cancel = new AbortController()
        const onAbort = (): void => cancel.abort()
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) {
          cancel.abort()
        }
        const credit = new RunOutputCredit(connectionId)
        credits.set(subscriptionId, credit)
        runtime.registerSubscriptionCleanup(subscriptionId, () => cancel.abort(), connectionId)
        try {
          const exit = await runOnLauncher(endpoint, params, {
            signal: cancel.signal,
            onStarted: (flow) => {
              credit.start(flow)
              emit({ type: 'ready', subscriptionId })
            },
            onOutput: (stream, data) => {
              emit({ [stream]: data })
              credit.sent(data.length)
            }
          })
          if (exit !== undefined) {
            emit({ exit })
          } else if (!signal?.aborted) {
            emit({ type: 'end', subscriptionId })
          }
        } finally {
          credits.delete(subscriptionId)
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
    }),
    defineMethod({
      name: 'desktop.run.ack',
      permission: 'workspace',
      params: DesktopRunAckParams,
      // Only the connection that started the run can release its output.
      handler: async (params, { connectionId }) => {
        const credit = credits.get(params.subscriptionId)
        if (!credit || !connectionId || credit.connectionId !== connectionId) {
          return { credited: false }
        }
        credit.ack(params.received)
        return { credited: true }
      }
    })
  ]
}

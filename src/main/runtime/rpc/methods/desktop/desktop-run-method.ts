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
/** Budget of unacknowledged output; each frame costs its payload bytes plus a fixed overhead. */
const MAX_UNACKED_OUTPUT_COST = 1024 * 1024
const OUTPUT_FRAME_OVERHEAD = 256

/**
 * Output credit of one run, counted in frames: reading pauses once the unacknowledged frames cost
 * more than the budget, so empty or tiny frames cannot queue without bound, and resumes on acks.
 */
class RunOutputCredit {
  /** Costs of sent frames not yet acknowledged, oldest first; at most budget / overhead + 1. */
  readonly #unacked: number[] = []
  #head = 0
  #unackedCost = 0
  #sentFrames = 0
  #ackedFrames = 0
  #flow: LauncherRunFlow | undefined
  #paused = false

  constructor(readonly connectionId: string | undefined) {}

  start(flow: LauncherRunFlow): void {
    this.#flow = flow
  }

  sent(data: string): void {
    const cost = Buffer.byteLength(data, 'utf8') + OUTPUT_FRAME_OVERHEAD
    this.#unacked.push(cost)
    this.#unackedCost += cost
    this.#sentFrames++
    if (!this.#paused && this.#unackedCost > MAX_UNACKED_OUTPUT_COST) {
      this.#paused = true
      this.#flow?.pause()
    }
  }

  /** `received`: output frames the client has taken so far (cumulative, idempotent). */
  ack(received: number): void {
    const target = Math.min(received, this.#sentFrames)
    while (this.#ackedFrames < target) {
      this.#unackedCost -= this.#unacked[this.#head] ?? 0
      this.#head++
      this.#ackedFrames++
    }
    if (this.#head > 1024 && this.#head * 2 > this.#unacked.length) {
      this.#unacked.splice(0, this.#head)
      this.#head = 0
    }
    if (this.#paused && this.#unackedCost <= MAX_UNACKED_OUTPUT_COST) {
      this.#paused = false
      this.#flow?.resume()
    }
  }
}

/**
 * Starts a GUI program through the in-environment launcher, which runs it as user `gui`
 * (the agent user has no display). Streams `ready`, then `{stdout}`/`{stderr}`, then `{exit}`;
 * unsubscribing, aborting or the connection closing kills the program's process group.
 * Clients acknowledge output frames with `desktop.run.ack`: past a 1 MiB budget the launcher
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
              credit.sent(data)
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

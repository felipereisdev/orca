import { randomUUID } from 'node:crypto'
import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import {
  DESKTOP_RECORD_DEFAULT_MAX_BYTES,
  DESKTOP_RECORD_DEFAULT_MAX_SECONDS,
  DesktopEventsParams,
  DesktopEventsUnsubscribeParams,
  DesktopRecordFenceParams,
  DesktopRecordingsListParams,
  DesktopRecordStartParams,
  DesktopRecordStopParams,
  DesktopRecordUnfenceParams
} from '../../../../../shared/rpc-contract/desktop/desktop-params'
import { defineMethod, defineStreamingMethod } from '../../core'
import {
  assertDesktopController,
  assertDesktopControllerToken
} from './desktop-controller-identity'

const EVENTS_SUBSCRIPTION_PREFIX = 'desktop-events:'

/**
 * Recording runs on the environment, so agents may start and stop it; `desktop.events` tells the
 * controlling host when a recording finished, and only that identity may subscribe.
 */
export function createDesktopRecordMethods(
  getBroker: () => DesktopBroker,
  recordingsDir: () => string
) {
  return [
    defineMethod({
      name: 'desktop.record.start',
      permission: 'workspace',
      params: DesktopRecordStartParams,
      handler: async (params) =>
        getBroker().recorder.start({
          maxSeconds: params.maxSeconds ?? DESKTOP_RECORD_DEFAULT_MAX_SECONDS,
          maxBytes: params.maxBytes ?? DESKTOP_RECORD_DEFAULT_MAX_BYTES,
          dir: recordingsDir()
        })
    }),
    defineMethod({
      name: 'desktop.record.stop',
      permission: 'workspace',
      params: DesktopRecordStopParams,
      handler: async () => getBroker().recorder.stop()
    }),
    defineMethod({
      name: 'desktop.recordings.list',
      permission: 'workspace',
      params: DesktopRecordingsListParams,
      handler: async () => {
        const { recorder } = getBroker()
        // Read first: a recording that finishes during the listing is then in it or still flagged.
        const inProgress = recorder.inProgress()
        const recordings = await recorder.list(recordingsDir())
        return { recordings, inProgress: inProgress || recorder.inProgress() }
      }
    }),
    defineMethod({
      name: 'desktop.record.fence',
      permission: 'host-admin',
      params: DesktopRecordFenceParams,
      handler: async (params, ctx) => {
        const broker = getBroker()
        assertDesktopControllerToken(broker, ctx, params.controllerToken)
        broker.recorder.removalFences.hold(params.fenceId)
        return { fenced: true }
      }
    }),
    defineMethod({
      name: 'desktop.record.unfence',
      permission: 'host-admin',
      params: DesktopRecordUnfenceParams,
      handler: async (params, ctx) => {
        const broker = getBroker()
        assertDesktopControllerToken(broker, ctx, params.controllerToken)
        broker.recorder.removalFences.release(params.fenceId)
        return { released: true }
      }
    }),
    defineStreamingMethod({
      name: 'desktop.events',
      permission: 'host-admin',
      params: DesktopEventsParams,
      handler: async (_params, ctx, emit) => {
        const broker = getBroker()
        assertDesktopController(broker, ctx)
        const { runtime, connectionId, signal } = ctx
        if (signal?.aborted) {
          return
        }
        const subscriptionId = `${EVENTS_SUBSCRIPTION_PREFIX}${randomUUID()}`
        let resolveEnded = (): void => {}
        const ended = new Promise<void>((resolve) => {
          resolveEnded = resolve
        })
        const stopListening = broker.recorder.onFinished(({ id, path, bytes }) =>
          emit({ type: 'recording-finished', id, path, bytes })
        )
        runtime.registerSubscriptionCleanup(subscriptionId, resolveEnded, connectionId)
        signal?.addEventListener('abort', resolveEnded, { once: true })
        try {
          emit({ type: 'ready', subscriptionId })
          await ended
          if (!signal?.aborted) {
            emit({ type: 'end', subscriptionId })
          }
        } finally {
          stopListening()
          signal?.removeEventListener('abort', resolveEnded)
          runtime.cleanupSubscription(subscriptionId)
        }
      }
    }),
    defineMethod({
      name: 'desktop.events.unsubscribe',
      permission: 'host-admin',
      params: DesktopEventsUnsubscribeParams,
      handler: async (params, { runtime, connectionId }) => {
        // Only event streams this connection opened: this must not end other subscriptions.
        if (!params.subscriptionId.startsWith(EVENTS_SUBSCRIPTION_PREFIX) || !connectionId) {
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

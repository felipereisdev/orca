import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { duplexPair } from 'node:stream'
import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { getDesktopBroker } from '../../../../desktop/desktop-broker-instance'
import { DesktopError } from '../../../../desktop/desktop-errors'
import { defaultRecordingsDir } from '../../../../desktop/desktop-recording-files'
import type { DesktopRunSessions } from '../../../../desktop/desktop-run-sessions'
import {
  DesktopConfigureParams,
  DesktopControlSetParams,
  DesktopStatusParams,
  DesktopViewerParams,
  DesktopViewerUnsubscribeParams
} from '../../../../../shared/rpc-contract/desktop/desktop-params'
import { defineMethod, defineStreamingMethod, type RpcContext } from '../../core'
import { createDesktopActionMethods } from './desktop-action-methods'
import {
  assertDesktopController,
  assertDesktopControllerToken,
  assertMayConfigureDesktop,
  claimDesktopController
} from './desktop-controller-identity'
import { createDesktopRecordMethods } from './desktop-record-methods'
import { DESKTOP_RECORDING_COPY_METHODS } from './desktop-recording-copy-methods'
import { createDesktopRunMethods } from './desktop-run-method'

const VIEWER_SUBSCRIPTION_PREFIX = 'desktop-viewer:'

/**
 * Bridges one subscription to a broker viewer: binary frames from the client become the viewer's
 * input and whatever the broker writes goes back as binary frames, until either side ends.
 */
async function streamViewer(
  broker: DesktopBroker,
  viewerId: string,
  { runtime, connectionId, sendBinary, registerBinaryMessageHandler, signal }: RpcContext,
  emit: (result: unknown) => void
): Promise<void> {
  if (!sendBinary || !registerBinaryMessageHandler) {
    throw new DesktopError('desktop_unavailable', 'desktop_viewer_binary_transport_required')
  }
  if (signal?.aborted) {
    return
  }
  const subscriptionId = `${VIEWER_SUBSCRIPTION_PREFIX}${randomUUID()}`
  const [rpcSide, brokerSide] = duplexPair()
  let resolveClosed = (): void => {}
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  rpcSide.on('error', () => {})
  rpcSide.once('end', () => resolveClosed())
  brokerSide.once('close', () => resolveClosed())
  rpcSide.on('data', (chunk: Buffer) => {
    // Dropped RFB bytes would desynchronize the stream, so a lost send ends the viewer.
    if (sendBinary(chunk) === false) {
      resolveClosed()
    }
  })
  const unregisterBinary = registerBinaryMessageHandler((bytes) => {
    if (!rpcSide.destroyed) {
      rpcSide.write(bytes)
    }
  })
  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) {
      return
    }
    cleaned = true
    unregisterBinary()
    signal?.removeEventListener('abort', cleanup)
    // A destroyed side means the broker already closed this viewer, maybe for a newer one with the same id.
    if (!brokerSide.destroyed) {
      broker.closeViewer(viewerId)
    }
    rpcSide.destroy()
    resolveClosed()
  }
  runtime.registerSubscriptionCleanup(subscriptionId, cleanup, connectionId)
  signal?.addEventListener('abort', cleanup, { once: true })
  try {
    emit({ type: 'ready', subscriptionId })
    try {
      await broker.openViewer(viewerId, brokerSide)
    } catch (error) {
      if (cleaned) {
        return
      }
      throw error
    }
    await closed
    if (!signal?.aborted) {
      emit({ type: 'end', subscriptionId })
    }
  } finally {
    cleanup()
    runtime.cleanupSubscription(subscriptionId)
  }
}

export type DesktopMethodsOptions = {
  /** Where default screenshots go, under `orca-desktop/`. */
  tmpDir?: () => string
  /** Where recordings go on the environment. */
  recordingsDir?: () => string
  /** Programs started through `desktop.run.start`; one set per process by default. */
  runSessions?: DesktopRunSessions
}

export function createDesktopMethods(
  getBroker: () => DesktopBroker = getDesktopBroker,
  { tmpDir = tmpdir, recordingsDir = defaultRecordingsDir, runSessions }: DesktopMethodsOptions = {}
) {
  return [
    ...createDesktopActionMethods(getBroker, tmpDir),
    ...createDesktopRunMethods(getBroker, runSessions),
    ...createDesktopRecordMethods(getBroker, recordingsDir),
    ...DESKTOP_RECORDING_COPY_METHODS,
    defineMethod({
      name: 'desktop.configure',
      permission: 'host-admin',
      params: DesktopConfigureParams,
      handler: async (params, ctx) => {
        const broker = getBroker()
        assertMayConfigureDesktop(ctx)
        // Proven before anything is claimed or changed: a wrong password leaves all as it was.
        await broker.verifyCredentials(params)
        const claim = claimDesktopController(broker, ctx)
        try {
          await broker.configure(params)
        } catch (error) {
          claim.release()
          throw error
        }
        const controllerToken = claim.bind()
        // A configure means the desktop is in use again: a removal fence no longer applies.
        broker.recorder.removalFences.clear()
        return { ...broker.status(), ...(controllerToken ? { controllerToken } : {}) }
      }
    }),
    defineMethod({
      name: 'desktop.status',
      permission: 'workspace',
      params: DesktopStatusParams,
      handler: async (params) => {
        const broker = getBroker()
        const status = broker.status()
        return params.viewerId === undefined
          ? status
          : { ...status, viewerControl: broker.viewerControl(params.viewerId) }
      }
    }),
    defineMethod({
      name: 'desktop.control.set',
      permission: 'workspace',
      params: DesktopControlSetParams,
      handler: async (params, ctx) => {
        const broker = getBroker()
        assertDesktopControllerToken(broker, ctx, params.controllerToken)
        broker.setOwner(params.owner, params.viewerId)
        return broker.status()
      }
    }),
    defineStreamingMethod({
      name: 'desktop.viewer',
      permission: 'workspace',
      params: DesktopViewerParams,
      handler: async (params, ctx, emit) => {
        const broker = getBroker()
        assertDesktopControllerToken(broker, ctx, params.controllerToken)
        await streamViewer(broker, params.viewerId, ctx, emit)
      }
    }),
    defineMethod({
      name: 'desktop.viewer.unsubscribe',
      permission: 'workspace',
      params: DesktopViewerUnsubscribeParams,
      handler: async (params, ctx) => {
        assertDesktopController(getBroker(), ctx)
        // Only viewer streams: this must not become a way to end other subscriptions.
        if (!params.subscriptionId.startsWith(VIEWER_SUBSCRIPTION_PREFIX)) {
          return { unsubscribed: false }
        }
        ctx.runtime.cleanupSubscription(params.subscriptionId)
        return { unsubscribed: true }
      }
    })
  ]
}

export const DESKTOP_METHODS = createDesktopMethods()

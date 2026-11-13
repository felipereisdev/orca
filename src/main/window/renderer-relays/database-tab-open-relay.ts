import { getRuntimeDesktopSurface } from '../../runtime/construction/runtime-desktop-surface'
import { randomUUID } from 'node:crypto'

import type { BrowserWindow } from 'electron'
import type {
  DatabaseTabOpenRequest,
  DatabaseTabOpenResponse
} from '../../../shared/database/database-tab-open'
import { addFanoutListener, addFanoutListeners } from '../../runtime/events/event-listener-fanout'

const OPEN_TIMEOUT_MS = 15_000

export async function requestDatabaseTabOpenFromRenderer(
  mainWindow: BrowserWindow,
  input: Omit<DatabaseTabOpenRequest, 'requestId'>
): Promise<string> {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    throw new Error('renderer_unavailable')
  }
  const webContents = mainWindow.webContents
  const requestId = randomUUID()
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const releaseListeners: (() => void)[] = []
    const finish = (error?: Error, tabId?: string): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      for (const release of releaseListeners) {
        release()
      }
      if (error) {
        reject(error)
      } else {
        resolve(tabId!)
      }
    }
    const onRendererUnavailable = (): void => finish(new Error('renderer_unavailable'))
    const onResponse = (event: Electron.IpcMainEvent, response: DatabaseTabOpenResponse): void => {
      if (event.sender !== webContents || response.requestId !== requestId) {
        return
      }
      finish(
        response.error
          ? new Error(response.error)
          : !response.tabId
            ? new Error('database_tab_open_failed')
            : undefined,
        response.tabId
      )
    }
    const timeout = setTimeout(
      () => finish(new Error('database_tab_open_timeout')),
      OPEN_TIMEOUT_MS
    )
    timeout.unref?.()
    const desktop = getRuntimeDesktopSurface()
    desktop.onIpc('ui:databaseTabOpenResponse', onResponse)
    releaseListeners.push(
      () => desktop.removeIpcListener('ui:databaseTabOpenResponse', onResponse),
      addFanoutListener(mainWindow, 'closed', onRendererUnavailable),
      addFanoutListeners(
        webContents,
        ['destroyed', 'render-process-gone', 'did-start-loading'],
        onRendererUnavailable
      )
    )
    const request: DatabaseTabOpenRequest = { ...input, requestId }
    try {
      webContents.send('ui:databaseTabOpenRequest', request)
    } catch {
      finish(new Error('renderer_unavailable'))
    }
  })
}

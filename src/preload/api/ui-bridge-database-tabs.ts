import { ipcRenderer } from 'electron'
import type { DatabaseTabUiApi } from '../../shared/database/database-tab-open'

export const uiDatabaseTabsApi = {
  onDatabaseTabOpenRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: Parameters<typeof callback>[0]) =>
      callback(request)
    ipcRenderer.on('ui:databaseTabOpenRequest', listener)
    return () => ipcRenderer.removeListener('ui:databaseTabOpenRequest', listener)
  },
  respondDatabaseTabOpen: (response) => {
    ipcRenderer.send('ui:databaseTabOpenResponse', response)
  }
} satisfies DatabaseTabUiApi

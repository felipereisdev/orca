export type DatabaseTabOpenRequest = {
  requestId: string
  worktreeId: string
  entityId: string
  tabId: string
  title: string
}
export type DatabaseTabOpenResponse = {
  requestId: string
  tabId?: string
  error?: string
}

export type DatabaseTabUiApi = {
  onDatabaseTabOpenRequest: (callback: (request: DatabaseTabOpenRequest) => void) => () => void
  respondDatabaseTabOpen: (response: DatabaseTabOpenResponse) => void
}

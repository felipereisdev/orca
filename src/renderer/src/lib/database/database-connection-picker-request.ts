export type DatabaseConnectionPickerRequest = {
  id: number
  worktreeId: string
  groupId?: string
}

type Listener = (request: DatabaseConnectionPickerRequest) => void

let listener: Listener | null = null
let nextRequestId = 0

export function subscribeDatabaseConnectionPicker(nextListener: Listener): () => void {
  listener = nextListener
  return () => {
    if (listener === nextListener) {
      listener = null
    }
  }
}

/** Opens a workspace's database connection: directly when it has one, otherwise through the picker. */
export function requestDatabaseConnectionPicker(target: { worktreeId: string; groupId?: string }) {
  nextRequestId += 1
  listener?.({ id: nextRequestId, ...target })
}

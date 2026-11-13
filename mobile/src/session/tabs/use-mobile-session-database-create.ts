import { useMemo, useRef, useState } from 'react'
import type { DatabaseConnectionRef } from '../../../../src/shared/database/database-contracts'
import { translate } from '../../i18n/mobile-i18n'
import { interpretOrThrowRefusalMessage } from '../../transport/rpc/rpc-refusal-message'
import type { MobileSessionTerminalCreateActionsModel } from '../../terminal/session/use-mobile-session-terminal-create-actions'
import { sessionTabOpenDatabase } from './mobile-session-tab-write-operations'

type DatabaseCreateState = { owner: object; show: boolean; creating: boolean; error: string }

export function useMobileSessionDatabaseCreate(scope: MobileSessionTerminalCreateActionsModel) {
  const { client, hostId, worktreeId } = scope
  const owner = useMemo(() => ({ client, hostId, worktreeId }), [client, hostId, worktreeId])
  const currentOwner = useRef(owner)
  currentOwner.current = owner
  const empty = { owner, show: false, creating: false, error: '' }
  const [state, setState] = useState<DatabaseCreateState>(empty)
  const displayed = state.owner === owner ? state : empty
  const pending = useRef<{ owner: object } | null>(null)
  function update(patch: Partial<Omit<DatabaseCreateState, 'owner'>>) {
    if (currentOwner.current !== owner) {
      return
    }
    setState((previous) => ({ ...(previous.owner === owner ? previous : empty), ...patch }))
  }
  async function handleCreateDatabase(connection: DatabaseConnectionRef): Promise<boolean> {
    if (!client || pending.current?.owner === owner) {
      return false
    }
    const opening = { owner }
    pending.current = opening
    update({ creating: true, error: '' })
    try {
      const response = await sessionTabOpenDatabase.request(
        client,
        { worktree: `id:${worktreeId}`, connection },
        { timeoutMs: 30_000, failWhenDisconnected: true }
      )
      const { tab } = interpretOrThrowRefusalMessage(
        () => sessionTabOpenDatabase.interpret(response),
        ''
      )
      if (currentOwner.current !== owner) {
        return false
      }
      const tabs = scope.sessionTabsRef.current
      if (!tabs.some((candidate) => candidate.id === tab.id)) {
        scope.sessionTabsRef.current = [...tabs, tab]
        scope.setSessionTabs(scope.sessionTabsRef.current)
      }
      update({ show: false })
      scope.switchSessionTab(tab)
      void scope.fetchSessionTabs()
      return true
    } catch (error) {
      update({
        error:
          error instanceof Error
            ? error.message
            : translate('database.mobile.openFailed', 'Could not open database')
      })
      return false
    } finally {
      if (pending.current === opening) {
        pending.current = null
        update({ creating: false })
      }
    }
  }
  return {
    creatingDatabase: displayed.creating,
    databaseCreateError: displayed.error,
    showDatabaseConnections: displayed.show,
    setShowDatabaseConnections: (show: boolean) => update({ show }),
    handleCreateDatabase
  }
}

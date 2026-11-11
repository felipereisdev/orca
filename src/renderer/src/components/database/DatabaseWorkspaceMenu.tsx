import { useEffect, useMemo, useState } from 'react'
import { Database } from 'lucide-react'
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { runtimeTargetForWorkspaceOwner } from '@/lib/workspace/ownership/resolve-owner'
import { createDatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import type { DatabaseConnectionSummary } from '../../../../shared/database/database-contracts'
import { openDatabaseExplorer } from '@/lib/database/database-explorer-tabs'
import { useTranslate } from '@/i18n/use-translate'
export function DatabaseWorkspaceMenu({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId?: string
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<DatabaseConnectionSummary[]>([])
  const [controllerRuntimeId, setControllerRuntimeId] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const target = useAppStore(
    useShallow((state) => runtimeTargetForWorkspaceOwner(state, { workspaceId: worktreeId }))
  )
  const client = useMemo(() => target && createDatabaseRuntimeClient(target), [target])
  useEffect(() => {
    if (!open || !client) {
      return
    }
    let active = true
    setError(null)
    setControllerRuntimeId(undefined)
    void Promise.all([client.list({ worktree: worktreeId }), client.controllerIdentity()])
      .then(([entries, identity]) => {
        if (active) {
          setEntries(entries)
          setControllerRuntimeId(identity)
        }
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
    return () => {
      active = false
    }
  }, [open, client, worktreeId])
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger disabled={!client} variant="create-row">
        <Database className="size-4 text-muted-foreground" />
        {t('database.workspace.open', 'Database connections')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-80">
        {error ? (
          <DropdownMenuLabel className="whitespace-normal">{error}</DropdownMenuLabel>
        ) : !controllerRuntimeId ? (
          <DropdownMenuLabel>
            {t('database.workspace.loading', 'Loading connections…')}
          </DropdownMenuLabel>
        ) : entries.length ? (
          entries.map((connection) => (
            <DropdownMenuItem
              key={connection.id}
              onSelect={() => {
                if (controllerRuntimeId) {
                  openDatabaseExplorer({
                    worktreeId,
                    groupId,
                    connection: { connectionId: connection.id, controllerRuntimeId }
                  })
                }
              }}
            >
              <span>@{connection.alias}</span>
              <span className="text-muted-foreground">{connection.environment}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuLabel>
            {t('database.workspace.empty', 'No connections associated with this project')}
          </DropdownMenuLabel>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

import { Database } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { useTranslate } from '@/i18n/use-translate'
import type { DatabaseConnectionSummary } from '../../../../shared/database/database-contracts'
import type { WorkspaceDatabaseConnections } from './use-workspace-database-connections'

/** A compact, searchable list of a workspace's database connections. */
export function DatabaseConnectionPickerDialog({
  open,
  connections,
  onOpenChange,
  onSelect
}: {
  open: boolean
  connections: WorkspaceDatabaseConnections
  onOpenChange: (open: boolean) => void
  onSelect: (connection: DatabaseConnectionSummary) => void
}): React.JSX.Element {
  const t = useTranslate()
  const notice =
    connections.status === 'loading'
      ? t('database.workspace.loading', 'Loading connections…')
      : connections.status === 'error'
        ? connections.message
        : connections.entries.length === 0
          ? t('database.workspace.empty', 'No connections associated with this project')
          : null
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('database.workspace.open', 'Database connections')}
      description={t('database.workspace.pickerDescription', 'Choose a connection to explore.')}
      contentClassName="w-[420px]"
      commandProps={{ loop: true }}
    >
      <CommandInput placeholder={t('database.workspace.search', 'Search connections…')} />
      <CommandList>
        {notice !== null ? (
          <div role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
            {notice}
          </div>
        ) : (
          <CommandEmpty>{t('database.workspace.noMatch', 'No matching connections')}</CommandEmpty>
        )}
        {connections.status === 'ready'
          ? connections.entries.map((connection) => (
              <CommandItem
                key={connection.id}
                value={`${connection.alias} ${connection.environment} ${connection.id}`}
                onSelect={() => onSelect(connection)}
              >
                <Database className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">@{connection.alias}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {connection.environment}
                </span>
              </CommandItem>
            ))
          : null}
      </CommandList>
    </CommandDialog>
  )
}

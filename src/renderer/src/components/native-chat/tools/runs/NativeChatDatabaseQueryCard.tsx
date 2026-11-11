import { Database, ExternalLink } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { openDatabaseExplorer } from '@/lib/database/database-explorer-tabs'
import type { DatabaseQuerySource } from '../../../../../../shared/database/database-query-contracts'
export function NativeChatDatabaseQueryCard({
  worktreeId,
  sessionId,
  controllerRuntimeId,
  queryId,
  source,
  status
}: {
  worktreeId: string
  sessionId: string
  controllerRuntimeId: string
  queryId: string
  source: DatabaseQuerySource
  status: string
}) {
  const t = useTranslate()
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() =>
        openDatabaseExplorer({
          worktreeId,
          sessionId,
          connection: { connectionId: source.connectionId, controllerRuntimeId },
          queryId
        })
      }
    >
      <Database className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          @{source.alias} · {source.environment}
        </span>
        <span className="block break-all text-xs text-muted-foreground">
          {source.engine} · {source.executionHostId} · {status} · {queryId.slice(0, 8)}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">
        {t('database.queryCard.open', 'Open query')}
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

import { Database, ShieldCheck, Plug, MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import type { DatabaseConnectionSummary } from '../../../../../shared/database/database-contracts'
import type { DatabaseSettingsOptions } from '../../../../../shared/database/database-settings-options'
import { databaseProjectIdentityKey } from '../../../../../shared/database/database-project-scope'
import { databaseEngineNames } from './database-connection-draft'

export type DatabaseConnectionTestState = {
  revision: number
  pending?: boolean
  serverVersion?: string
  readOnlyProfile?: boolean
  error?: string
}
export function DatabaseConnectionRows({
  connections,
  options,
  tests,
  onEdit,
  onTest,
  onRemove
}: {
  connections: DatabaseConnectionSummary[]
  options: DatabaseSettingsOptions | null
  tests: Record<string, DatabaseConnectionTestState>
  onEdit(id: string): void
  onTest(connection: DatabaseConnectionSummary): void
  onRemove(connection: DatabaseConnectionSummary): void
}) {
  const t = useTranslate()
  const projects = new Map(options?.projects.map((project) => [project.key, project.label]) ?? [])
  const hosts = new Map(options?.hosts.map((host) => [host.executionHostId, host.label]) ?? [])
  return (
    <div className="divide-y divide-border border-y border-border">
      <div className="hidden grid-cols-[minmax(0,1.5fr)_0.9fr_1fr_minmax(0,1fr)_auto] gap-3 py-3 text-xs text-muted-foreground @2xl:grid">
        <span>{t('database.catalog.connection', 'Connection')}</span>
        <span>{t('database.form.environment', 'Environment')}</span>
        <span>{t('database.form.executionHost', 'Execute on')}</span>
        <span>{t('database.catalog.projects', 'Projects')}</span>
        <span className="w-24" />
      </div>
      {connections.map((connection) => {
        const test =
          tests[connection.id]?.revision === connection.revision ? tests[connection.id] : undefined
        const verified = test?.readOnlyProfile === true && !test.error && !test.pending
        return (
          <div key={connection.id} className="py-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 @2xl:grid-cols-[minmax(0,1.5fr)_0.9fr_1fr_minmax(0,1fr)_auto]">
              <div className="col-span-2 flex min-w-0 items-start gap-2 @2xl:col-span-1">
                <Database className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <span className="block truncate font-mono text-sm font-medium">
                    @{connection.alias}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {databaseEngineNames[connection.engine]}
                  </span>
                </div>
              </div>
              <div>
                <Badge variant="outline">{connection.environment}</Badge>
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {hosts.get(connection.executionHostId) ?? connection.executionHostId}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {connection.projects.length
                  ? connection.projects
                      .map(
                        (project) =>
                          projects.get(databaseProjectIdentityKey(project)) ?? project.projectId
                      )
                      .join(', ')
                  : t('database.catalog.unassociated', 'No projects')}
              </span>
              <div className="flex items-center justify-end gap-1 @2xl:w-24">
                <Button variant="ghost" size="sm" onClick={() => onEdit(connection.id)}>
                  {t('database.edit', 'Edit')}
                </Button>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('database.catalog.actions', 'Actions for @{{alias}}', {
                            alias: connection.alias
                          })}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('database.catalog.moreActions', 'Connection actions')}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={test?.pending} onSelect={() => onTest(connection)}>
                      <Plug className="size-4" />
                      {t('database.catalog.test', 'Test connection')}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => onRemove(connection)}>
                      <Trash2 className="size-4" />
                      {t('database.remove.action', 'Remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {test?.pending || verified ? (
              <div
                role="status"
                className="mt-2 flex items-center gap-1.5 pl-6 text-xs text-muted-foreground"
              >
                {test?.pending ? (
                  <LoadingSpinner className="size-3.5" />
                ) : (
                  <ShieldCheck className="size-3.5" />
                )}
                {test?.pending
                  ? t('database.catalog.checking', 'Checking connection and read-only profile…')
                  : t('database.catalog.verified', 'Read-only profile verified')}
                {verified && test.serverVersion ? ` · ${test.serverVersion}` : ''}
              </div>
            ) : null}
            {test?.error ? (
              <p role="alert" className="mt-2 pl-6 text-xs text-destructive">
                {test.error}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

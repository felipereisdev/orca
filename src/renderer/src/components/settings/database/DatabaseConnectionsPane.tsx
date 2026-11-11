import { useCallback, useEffect, useState } from 'react'
import { Database, Plus, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useTranslate } from '@/i18n/use-translate'
import type { DatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import type { DatabaseConnectionSummary } from '../../../../../shared/database/database-contracts'
import type { DatabaseSettingsOptions } from '../../../../../shared/database/database-settings-options'
import { DatabaseConnectionSheet } from './DatabaseConnectionSheet'
import { DatabaseConnectionRows, type DatabaseConnectionTestState } from './DatabaseConnectionRows'
import { databaseEngineNames } from './database-connection-draft'
import { filterDatabaseConnections } from './database-connections-search'

export function DatabaseConnectionsPane({ client }: { client: DatabaseRuntimeClient }) {
  const t = useTranslate()
  const confirm = useConfirmationDialog()
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([])
  const [options, setOptions] = useState<DatabaseSettingsOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [engine, setEngine] = useState('all')
  const [edit, setEdit] = useState<string | null | undefined>()
  const [tests, setTests] = useState<Record<string, DatabaseConnectionTestState>>({})
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([client.catalog(), client.settingsOptions()])
      .then(([catalog, choices]) => {
        setConnections(catalog)
        setOptions(choices)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [client])
  useEffect(() => {
    void reload()
  }, [reload])
  async function test(connection: DatabaseConnectionSummary) {
    setTests((current) => ({
      ...current,
      [connection.id]: { revision: connection.revision, pending: true }
    }))
    try {
      const result = await client.test(connection.id)
      setTests((current) => ({
        ...current,
        [connection.id]: {
          revision: connection.revision,
          ...result,
          error: result.readOnlyProfile
            ? undefined
            : t(
                'database.catalog.profileFailed',
                'The account does not match the read-only profile'
              )
        }
      }))
    } catch (reason) {
      setTests((current) => ({
        ...current,
        [connection.id]: {
          revision: connection.revision,
          error: reason instanceof Error ? reason.message : String(reason)
        }
      }))
    }
  }
  async function clearHistory(connection: DatabaseConnectionSummary) {
    if (
      !(await confirm({
        title: t('database.history.clearTitle', 'Clear query history for @{{alias}}?', {
          alias: connection.alias
        }),
        description: t(
          'database.history.clearHelp',
          'Deletes stored SQL and cached results, and cancels running queries. Open panels and agent conversations retain data already displayed.'
        ),
        confirmLabel: t('database.history.clear', 'Clear query history'),
        confirmVariant: 'destructive',
        surface: 'security'
      }))
    ) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      await client.clearHistory(connection.id)
      setNotice(
        t('database.history.cleared', 'Query history cleared for @{{alias}}', {
          alias: connection.alias
        })
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  async function remove(connection: DatabaseConnectionSummary) {
    if (
      !(await confirm({
        title: t('database.remove.title', 'Remove database connection?'),
        description: t(
          'database.remove.help',
          'This removes @{{alias}} and its project associations. The alias cannot be reused.',
          { alias: connection.alias }
        ),
        confirmLabel: t('database.remove.action', 'Remove'),
        confirmVariant: 'destructive',
        surface: 'security'
      }))
    ) {
      return
    }
    try {
      await client.remove(connection.id, connection.revision)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const visible = filterDatabaseConnections(connections, options, query, engine)
  return (
    <div className="@container space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-settings-heading font-semibold">
            {t('database.settings.title', 'Database connections')}
          </h2>
          <p className="text-settings-detail text-muted-foreground">
            {t(
              'database.settings.description',
              'Register read-only environments and associate them with projects'
            )}
          </p>
        </div>
        <Button onClick={() => setEdit(null)} disabled={!options || loading}>
          <Plus className="size-4" />
          {t('database.add', 'New connection')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('database.catalog.search', 'Search connections')}
          placeholder={t(
            'database.catalog.searchPlaceholder',
            'Search name, alias or environment…'
          )}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-40 flex-1"
        />
        <Select value={engine} onValueChange={setEngine}>
          <SelectTrigger className="w-40" aria-label={t('database.form.engine', 'Database type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('database.catalog.allTypes', 'All types')}</SelectItem>
            {Object.entries(databaseEngineNames).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {loading || error ? '—' : visible.length}
        </span>
      </div>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void reload()}>
            {t('database.retry', 'Retry')}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <div className="min-h-32" role="status">
          <p className="text-sm text-muted-foreground">
            {t('database.catalog.loading', 'Loading connections…')}
          </p>
        </div>
      ) : error && !options ? null : visible.length ? (
        <DatabaseConnectionRows
          connections={visible}
          options={options}
          tests={tests}
          onEdit={setEdit}
          onTest={(connection) => void test(connection)}
          onClearHistory={(connection) => void clearHistory(connection)}
          onRemove={(connection) => void remove(connection)}
        />
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center">
          <Database className="size-5 text-muted-foreground" />
          <p className="text-sm">
            {connections.length
              ? t('database.catalog.noMatches', 'No connections match this search')
              : t('database.catalog.empty', 'Add your first database environment')}
          </p>
          {!connections.length ? (
            <Button variant="outline" disabled={!options} onClick={() => setEdit(null)}>
              {t('database.add', 'New connection')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setQuery('')
                setEngine('all')
              }}
            >
              {t('database.catalog.clearSearch', 'Clear search')}
            </Button>
          )}
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockKeyhole className="size-4 shrink-0" />
        {t(
          'database.catalog.readOnlyHelp',
          'Queries use the selected environment and are restricted to read-only access. Credentials stay on the execution host.'
        )}
      </p>
      {edit !== undefined && options ? (
        <DatabaseConnectionSheet
          key={edit ?? 'new'}
          client={client}
          connectionId={edit}
          options={options}
          onClose={() => setEdit(undefined)}
          onSaved={() => {
            setEdit(undefined)
            void reload()
          }}
        />
      ) : null}
    </div>
  )
}

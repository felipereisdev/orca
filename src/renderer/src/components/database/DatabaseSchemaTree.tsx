import { KeyRound, Table2, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type {
  DatabaseSchemaResult,
  DatabaseTable
} from '../../../../shared/database/database-contracts'
export function DatabaseSchemaTree({
  value,
  table,
  loading,
  error,
  onSchema,
  onTable,
  onPreview,
  onAdd
}: {
  value: DatabaseSchemaResult | null
  table: DatabaseTable | null
  loading: boolean
  error: string | null
  onSchema: (schema: string) => void
  onTable: (table: DatabaseTable) => void
  onPreview: () => void
  onAdd: (button: HTMLButtonElement) => void
}) {
  const t = useTranslate()
  return (
    <aside className="w-56 shrink-0 overflow-auto scrollbar-sleek border-r border-border p-3 text-xs">
      <h2 className="mb-3 font-medium">{t('database.explorer.schema', 'Schema')}</h2>
      {loading && (
        <p className="text-muted-foreground">
          {t('database.explorer.schemaLoading', 'Loading schema…')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {value?.schemas.map((schema) => (
        <Button
          key={schema}
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => onSchema(schema)}
        >
          {schema}
        </Button>
      ))}
      {value?.tables.map((entry) => (
        <Button
          key={JSON.stringify([entry.schema, entry.name])}
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          aria-pressed={table?.schema === entry.schema && table.name === entry.name}
          onClick={() => onTable(entry)}
        >
          {entry.kind === 'view' ? <Eye /> : <Table2 />}
          <span className="truncate">{entry.name}</span>
        </Button>
      ))}
      {table && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="font-medium break-all">
            {table.schema}.{table.name}
          </p>
          <Button variant="outline" size="sm" onClick={onPreview}>
            {t('database.explorer.preview', 'Preview rows')}
          </Button>
          {value?.columns.map((column) => (
            <div key={column.name} className="flex items-start gap-2">
              {column.primaryKey && (
                <KeyRound className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className="break-all">{column.name}</p>
                <p className="text-muted-foreground break-all">
                  {column.databaseType}
                  {column.nullable ? ` · ${t('database.explorer.nullable', 'nullable')}` : ''}
                </p>
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || !value}
            onClick={(event) => onAdd(event.currentTarget)}
          >
            {t('database.explorer.addSchema', 'Add schema to chat')}
          </Button>
        </div>
      )}
      {value?.truncated && (
        <p className="mt-3 text-muted-foreground">
          {t('database.explorer.schemaTruncated', 'Schema listing truncated')}
        </p>
      )}
    </aside>
  )
}

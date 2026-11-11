import { Button } from '@/components/ui/button'
import { useTranslate, useIntlLocale } from '@/i18n/use-translate'
import type { DatabaseExplorerResult, DatabaseCellSelection } from './database-explorer-state'
import type { DatabaseCell } from '../../../../shared/database/database-query-contracts'
export const databaseCellText = (cell: DatabaseCell) =>
  cell === null ? 'NULL' : typeof cell === 'object' ? cell.text : String(cell)
export function DatabaseResultsTable({
  result,
  selection,
  onSelect,
  onAdd,
  onQuery
}: {
  result: DatabaseExplorerResult | null
  selection: DatabaseCellSelection[]
  onSelect: (queryId: string, row: number, columnId: string) => void
  onAdd: (button: HTMLButtonElement) => void
  onQuery: (button: HTMLButtonElement) => void
}) {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  if (!result) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {t('database.explorer.noResults', 'Run a query to see results')}
      </p>
    )
  }
  const { source } = result.record
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
        <span className="font-medium">@{source.alias}</span>
        <span>{source.environment}</span>
        <span className="text-muted-foreground">{source.executionHostId}</span>
        <time className="text-muted-foreground">
          {new Date(result.record.createdAt).toLocaleString(intlLocale)}
        </time>
        <span className="text-muted-foreground">{result.status}</span>
        <Button size="xs" variant="ghost" onClick={(event) => onQuery(event.currentTarget)}>
          {t('database.explorer.addQuery', 'Add query to chat')}
        </Button>
        {result.status === 'completed' && (
          <Button
            size="xs"
            variant="ghost"
            disabled={!selection.length}
            onClick={(event) => onAdd(event.currentTarget)}
          >
            {t('database.explorer.addSelected', 'Add selected data to chat')}
          </Button>
        )}
      </div>
      {result.status === 'expired' ? (
        <p className="p-4 text-xs text-muted-foreground">
          {t(
            'database.explorer.expired',
            'These cached results have expired. Run the query explicitly to retrieve fresh data.'
          )}
        </p>
      ) : result.status === 'failed' || result.status === 'cancelled' ? (
        <p role="alert" className="p-4 text-xs text-destructive">
          {result.record.error?.message ?? result.status}
        </p>
      ) : result.status === 'completed' ? (
        <>
          <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-background">
                <tr>
                  {result.columns.map((column) => (
                    <th
                      key={column.id}
                      className="border-b border-r border-border px-3 py-2 font-medium"
                    >
                      <span className="block">{column.name}</span>
                      <span className="font-normal text-muted-foreground">
                        {column.databaseType}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {result.columns.map((column, columnIndex) => (
                      <td key={column.id} className="max-w-80 border-b border-r border-border">
                        <button
                          type="button"
                          aria-pressed={selection.some(
                            (cell) =>
                              cell.queryId === result.record.queryId &&
                              cell.row === rowIndex &&
                              cell.columnId === column.id
                          )}
                          className="w-full px-3 py-2 text-left whitespace-pre-wrap break-words hover:bg-accent aria-pressed:bg-accent"
                          onClick={() => onSelect(result.record.queryId, rowIndex, column.id)}
                        >
                          {databaseCellText(row[columnIndex])}
                          {typeof row[columnIndex] === 'object' && row[columnIndex] !== null && (
                            <span className="text-muted-foreground">…</span>
                          )}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {t('database.explorer.rowCount', '{{count}} rows', { count: result.rowCount })}
            {result.truncated &&
              ` · ${t('database.explorer.truncated', 'Truncated by query limits')}`}
          </p>
        </>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          {t('database.explorer.running', 'Query in progress…')}
        </p>
      )}
    </section>
  )
}

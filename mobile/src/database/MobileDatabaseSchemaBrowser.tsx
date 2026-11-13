import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { ChevronLeft, KeyRound, Table2 } from 'lucide-react-native'
import type {
  DatabaseConnectionRef,
  DatabaseConnectionSummary,
  DatabaseSchemaResult,
  DatabaseTable
} from '../../../src/shared/database/database-contracts'
import { buildDatabaseTablePreview } from '../../../src/shared/database/database-table-preview'
import { ListRow } from '../components/list/ListGroup'
import { MobileSearchField } from '../components/MobileSearchField'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import type { MobileDatabaseClient } from './mobile-database-rpc'
import { databaseStyles as styles } from './mobile-database-styles'

type Props = {
  api: MobileDatabaseClient
  reference: DatabaseConnectionRef
  connection: DatabaseConnectionSummary
  onUseSql: (sql: string) => void
}

export function MobileDatabaseSchemaBrowser({ api, reference, connection, onUseSql }: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [path, setPath] = useState<{ schema?: string; table?: DatabaseTable }>({})
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<DatabaseSchemaResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError(null)
    setData(null)
    void (async () => {
      if ((await api.controllerIdentity()) !== reference.controllerRuntimeId) {
        throw new Error(
          t(
            'database.mobile.controllerChanged',
            'The database controller has changed. Open the connection again from New Tab.'
          )
        )
      }
      if (abort.signal.aborted) {
        return
      }
      const value = await api.describe(
        reference.connectionId,
        path.schema,
        path.table?.name,
        abort.signal
      )
      if (!abort.signal.aborted) {
        setData(value)
      }
    })()
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setLoading(false)
        }
      })
    return () => abort.abort()
  }, [api, reference.connectionId, reference.controllerRuntimeId, path, revision, t])
  const go = (next: typeof path) => {
    setSearch('')
    setPath(next)
  }
  const query = search.trim().toLocaleLowerCase()
  const entries = path.table
    ? (data?.columns ?? []).map((column) => ({
        key: column.name,
        title: column.name,
        subtitle: `${column.databaseType}${column.nullable ? ' · NULL' : ' · NOT NULL'}`,
        column
      }))
    : path.schema
      ? (data?.tables ?? []).map((table) => ({
          key: JSON.stringify([table.schema, table.name]),
          title: table.name,
          subtitle: table.kind,
          table
        }))
      : (data?.schemas ?? []).map((schema) => ({
          key: schema,
          title: schema,
          subtitle: '',
          schema
        }))
  const visible = entries.filter((entry) => entry.title.toLocaleLowerCase().includes(query))
  return (
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <View style={styles.row}>
          {path.schema ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back', 'Back')}
              onPress={() => go(path.table ? { schema: path.schema } : {})}
              style={styles.button}
            >
              <ChevronLeft size={20} color={colors.textPrimary} />
            </Pressable>
          ) : null}
          <Text selectable style={[styles.title, styles.grow]} numberOfLines={2}>
            {path.table
              ? `${path.schema}.${path.table.name}`
              : (path.schema ?? t('database.mobile.schemas', 'Schemas'))}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRevision((value) => value + 1)}
            style={styles.button}
            disabled={loading}
          >
            <Text style={styles.meta}>{t('common.refresh', 'Refresh')}</Text>
          </Pressable>
        </View>
        <MobileSearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('database.mobile.filterStructure', 'Filter structure')}
        />
        {path.table && data && !loading ? (
          <Pressable
            accessibilityRole="button"
            disabled={!data.columns.length}
            onPress={() => {
              if (path.table) {
                onUseSql(
                  buildDatabaseTablePreview(
                    connection.engine,
                    path.table,
                    100,
                    data.columns.map((column) => column.name)
                  )
                )
              }
            }}
            style={({ pressed }) => [
              styles.button,
              styles.secondary,
              !data.columns.length && styles.disabled,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.text}>
              {t('database.mobile.previewSql', 'Prepare SELECT · 100 rows')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.content}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(entry) => entry.key}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ListRow
              title={item.title}
              subtitle={item.subtitle || undefined}
              leading={
                'column' in item ? (
                  item.column.primaryKey ? (
                    <KeyRound size={16} color={colors.textSecondary} />
                  ) : undefined
                ) : (
                  <Table2 size={16} color={colors.textSecondary} />
                )
              }
              navigates={!('column' in item)}
              onPress={
                'schema' in item
                  ? () => go({ schema: item.schema })
                  : 'table' in item
                    ? () => go({ schema: item.table.schema, table: item.table })
                    : undefined
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.content}>
              <Text style={styles.meta}>
                {t('database.mobile.emptyStructure', 'No matching items.')}
              </Text>
            </View>
          }
          ListFooterComponent={
            data?.truncated ? (
              <View style={styles.content}>
                <Text style={styles.meta}>
                  {t(
                    'database.mobile.structureTruncated',
                    'The host limited this structure listing.'
                  )}
                </Text>
              </View>
            ) : undefined
          }
        />
      )}
    </View>
  )
}

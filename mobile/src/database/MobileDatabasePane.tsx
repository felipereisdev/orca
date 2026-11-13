import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Keyboard, Pressable, Text, View } from 'react-native'
import type {
  DatabaseConnectionRef,
  DatabaseConnectionSummary
} from '../../../src/shared/database/database-contracts'
import { databaseExplorerReference } from '../../../src/shared/database/database-explorer-reference'
import type { DatabaseQueryStatus } from '../../../src/shared/database/database-query-contracts'
import { FieldTextInput } from '../components/composer-input/FieldTextInput'
import { MobileSegmentedControl } from '../components/MobileSegmentedControl'
import { useDurableDraftField } from '../drafts/durable-draft-fields'
import { workspaceDraftRowKey } from '../drafts/durable-draft-rows'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import type { MobileDatabaseClient } from './mobile-database-rpc'
import { useMobileDatabaseConnections } from './use-mobile-database-connections'
import { useMobileDatabaseQuery } from './use-mobile-database-query'
import { MobileDatabaseSchemaBrowser } from './MobileDatabaseSchemaBrowser'
import { MobileDatabaseQueryResults } from './MobileDatabaseQueryResults'
import { databaseStyles as styles } from './mobile-database-styles'

type Props = {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  executionHost?: string
  entityId: string
  keyboardLift: number
  bottomInset: number
}

export function MobileDatabasePane(props: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const reference = useMemo(() => {
    try {
      return databaseExplorerReference(props.entityId)
    } catch {
      return null
    }
  }, [props.entityId])
  if (!reference) {
    return (
      <View style={styles.empty}>
        <Text style={styles.error}>
          {t(
            'database.mobile.invalidTab',
            'This database tab is invalid. Open the connection again from New Tab.'
          )}
        </Text>
      </View>
    )
  }
  return <ConnectionPane {...props} reference={reference} />
}

function ConnectionPane(props: Props & { reference: DatabaseConnectionRef }) {
  const t = useMobileTranslation()
  const catalog = useMobileDatabaseConnections(
    props.client,
    props.worktreeId,
    props.reference.controllerRuntimeId
  )
  const connection = catalog.connections.find((entry) => entry.id === props.reference.connectionId)
  if (catalog.loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }
  if (catalog.error || !connection || !catalog.api) {
    return (
      <View style={styles.empty}>
        <Text accessibilityRole="alert" style={styles.error}>
          {catalog.error ??
            t(
              'database.mobile.connectionUnavailable',
              'This connection is no longer available to this project. Configure project connections on your computer.'
            )}
        </Text>
        <Pressable accessibilityRole="button" onPress={catalog.refresh} style={styles.button}>
          <Text style={styles.text}>{t('common.retry', 'Retry')}</Text>
        </Pressable>
      </View>
    )
  }
  return <DatabaseContent {...props} api={catalog.api} connection={connection} />
}

function DatabaseContent({
  api,
  reference,
  connection,
  hostId,
  executionHost,
  worktreeId,
  entityId,
  keyboardLift,
  bottomInset
}: Props & {
  reference: DatabaseConnectionRef
  connection: DatabaseConnectionSummary
  api: MobileDatabaseClient
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [section, setSection] = useState<'structure' | 'sql' | 'history'>('structure')
  const [paneHeight, setPaneHeight] = useState(0)
  const [editingSql, setEditingSql] = useState(true)
  const compact = paneHeight > 0 && paneHeight - Math.max(keyboardLift, bottomInset) < 420
  const [sql, setSql] = useDurableDraftField(
    workspaceDraftRowKey('databaseSql', { hostId, executionHost, worktreeId }, entityId),
    'sql'
  )
  const query = useMobileDatabaseQuery(api, reference)
  const busy = query.starting || query.running || query.loadingResult
  const resultCount =
    query.snapshot?.status === 'completed'
      ? query.snapshot.record.affectedRows !== undefined
        ? t('database.mobile.affectedRows', '{{count}} affected rows', {
            count: query.snapshot.record.affectedRows
          })
        : t('database.mobile.rowCount', '{{count}} rows', { count: query.snapshot.rowCount })
      : ''
  const statusLabels: Record<DatabaseQueryStatus, string> = {
    queued: t('database.mobile.queued', 'Queued'),
    running: t('database.mobile.running', 'Running'),
    completed: t('database.mobile.completed', 'Completed'),
    failed: t('database.mobile.failed', 'Failed'),
    cancelled: t('database.mobile.cancelled', 'Query cancelled')
  }
  return (
    <View
      style={[styles.pane, { paddingBottom: Math.max(keyboardLift, bottomInset) }]}
      onLayout={(event) => setPaneHeight(event.nativeEvent.layout.height)}
    >
      <View style={styles.toolbar}>
        <Text style={styles.title} numberOfLines={1}>
          {connection.displayName || connection.alias}
          {compact ? ` · ${connection.environment}` : ''}
        </Text>
        {!compact ? (
          <Text style={styles.meta} numberOfLines={2}>
            {[
              connection.environment,
              connection.engine,
              connection.accessMode === 'read-write'
                ? t('database.mobile.readWrite', 'Read / write')
                : t('database.mobile.readOnly', 'Read only')
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        <MobileSegmentedControl
          tabs
          fill
          selected={section}
          onSelect={(value) => {
            setSection(value)
            if (value === 'history') {
              void query.refreshHistory()
            }
          }}
          segments={[
            { value: 'structure', label: t('database.mobile.structure', 'Structure') },
            { value: 'sql', label: t('database.mobile.sql', 'SQL') },
            { value: 'history', label: t('database.mobile.history', 'History') }
          ]}
        />
      </View>
      {section === 'structure' ? (
        <MobileDatabaseSchemaBrowser
          api={api}
          reference={reference}
          connection={connection}
          onUseSql={(value) => {
            setSql(value)
            setEditingSql(true)
            setSection('sql')
          }}
        />
      ) : section === 'history' ? (
        <View style={styles.body}>
          <View style={styles.toolbar}>
            <View style={styles.spread}>
              <Text style={[styles.meta, styles.grow]}>
                {t('database.mobile.deviceHistory', 'Queries from this device')}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={query.historyLoading}
                onPress={() => void query.refreshHistory()}
                style={styles.button}
              >
                <Text style={styles.meta}>{t('common.refresh', 'Refresh')}</Text>
              </Pressable>
            </View>
            {query.historyLoading ? <ActivityIndicator color={colors.textSecondary} /> : null}
            {query.historyError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {query.historyError}
              </Text>
            ) : null}
          </View>
          <FlatList
            data={query.history}
            keyExtractor={(record) => record.queryId}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                onPress={() => {
                  setSql(item.sql)
                  setEditingSql(false)
                  setSection('sql')
                  void query.openQuery(item)
                }}
                style={({ pressed }) => [
                  styles.historyRow,
                  busy && styles.disabled,
                  pressed && styles.pressed
                ]}
              >
                <Text style={[styles.text, styles.mono]} numberOfLines={3}>
                  {item.sql}
                </Text>
                <Text style={styles.meta}>
                  {new Date(item.createdAt).toLocaleString()} · {statusLabels[item.status]} ·{' '}
                  {item.rowCount}
                </Text>
                {item.parameterNames.length ? (
                  <Text style={styles.meta}>
                    {t(
                      'database.mobile.parameterValuesNotSaved',
                      'Parameter values are not saved in history.'
                    )}
                  </Text>
                ) : null}
              </Pressable>
            )}
            ListEmptyComponent={
              !query.historyLoading && !query.historyError ? (
                <View style={styles.content}>
                  <Text style={styles.meta}>
                    {t(
                      'database.mobile.noHistory',
                      'No queries from this device for this connection.'
                    )}
                  </Text>
                </View>
              ) : undefined
            }
          />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.toolbar}>
            {!compact || editingSql ? (
              <FieldTextInput
                accessibilityLabel={t('database.mobile.sqlQuery', 'SQL query')}
                value={sql}
                onChangeText={setSql}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                maxLength={65536}
                placeholder={t('database.mobile.sqlPlaceholder', 'SELECT …')}
                style={[styles.editor, compact && styles.compactEditor]}
              />
            ) : null}
            <View style={styles.spread}>
              <View style={[styles.row, styles.grow]}>
                {compact && !editingSql ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setEditingSql(true)}
                    style={styles.button}
                  >
                    <Text style={styles.text}>{t('database.mobile.editSql', 'Edit SQL')}</Text>
                  </Pressable>
                ) : null}
                {busy ? <ActivityIndicator color={colors.textSecondary} /> : null}
                <Text style={styles.meta}>
                  {query.starting
                    ? t('database.mobile.starting', 'Starting…')
                    : query.loadingResult
                      ? t('database.mobile.loadingResult', 'Loading result…')
                      : query.snapshot
                        ? query.snapshot.status === 'expired'
                          ? t('database.mobile.expired', 'Expired')
                          : statusLabels[query.snapshot.status]
                        : ''}
                  {compact && resultCount ? ` · ${resultCount}` : ''}
                </Text>
              </View>
              {query.running ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={query.cancelling}
                  onPress={() => void query.cancel()}
                  style={({ pressed }) => [
                    styles.button,
                    styles.secondary,
                    query.cancelling && styles.disabled,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={styles.text}>
                    {query.cancelling
                      ? t('database.mobile.cancelling', 'Cancelling…')
                      : t('common.cancel', 'Cancel')}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !sql.trim()}
                  onPress={() => {
                    Keyboard.dismiss()
                    setEditingSql(false)
                    void query.execute(sql)
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    styles.primary,
                    (busy || !sql.trim()) && styles.disabled,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={styles.primaryText}>{t('database.mobile.run', 'Run')}</Text>
                </Pressable>
              )}
            </View>
            {query.error ? (
              <View style={styles.notice}>
                <Text selectable accessibilityRole="alert" style={styles.error}>
                  {query.error}
                </Text>
                {query.queryId ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void query.retryResult()}
                    style={styles.button}
                  >
                    <Text style={styles.text}>
                      {t('database.mobile.retryResult', 'Reload result')}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.meta}>
                    {t(
                      'database.mobile.checkHistoryBeforeRetry',
                      'Check History before running again if the connection was interrupted.'
                    )}
                  </Text>
                )}
              </View>
            ) : null}
          </View>
          <MobileDatabaseQueryResults snapshot={query.snapshot} compact={compact} />
        </View>
      )}
    </View>
  )
}

import { useState } from 'react'
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native'
import type {
  DatabaseCell,
  DatabaseQuerySnapshot,
  ExpiredDatabaseResult
} from '../../../src/shared/database/database-query-contracts'
import { BottomDrawer } from '../components/bottom-drawer/BottomDrawer'
import { SheetHeader } from '../components/nav-bar/SheetHeader'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { databaseStyles as styles } from './mobile-database-styles'

export function databaseCellText(cell: DatabaseCell | undefined): string {
  if (cell == null) {
    return 'NULL'
  }
  return typeof cell === 'object' ? `${cell.text}…` : String(cell)
}

export function MobileDatabaseQueryResults({
  snapshot,
  compact = false
}: {
  snapshot: DatabaseQuerySnapshot | ExpiredDatabaseResult | null
  compact?: boolean
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [cell, setCell] = useState<{ title: string; value: string } | null>(null)
  if (!snapshot) {
    return (
      <View style={[styles.content, compact && styles.compactContent]}>
        <Text style={styles.meta}>
          {t('database.mobile.queryHint', 'Run a query or open a result from History.')}
        </Text>
      </View>
    )
  }
  if (snapshot.status === 'expired') {
    return (
      <View style={styles.content}>
        <Text style={styles.meta}>
          {t(
            'database.mobile.resultExpired',
            'This result has expired on the host. The SQL is available above; run it again to obtain a new result.'
          )}
        </Text>
      </View>
    )
  }
  if (snapshot.status === 'failed' || snapshot.status === 'cancelled') {
    return (
      <View style={styles.content}>
        <Text selectable style={snapshot.status === 'failed' ? styles.error : styles.meta}>
          {snapshot.record.error?.message ?? t('database.mobile.cancelled', 'Query cancelled')}
        </Text>
      </View>
    )
  }
  if (snapshot.status !== 'completed') {
    return (
      <View style={styles.content}>
        <Text style={styles.meta}>
          {t('database.mobile.waitingForResult', 'Waiting for the host’s query result…')}
        </Text>
      </View>
    )
  }
  const width = snapshot.columns.length * 160
  return (
    <View style={styles.body}>
      {!compact || snapshot.truncated ? (
        <View style={[styles.content, compact && styles.compactContent]}>
          <Text style={styles.meta}>
            {snapshot.record.affectedRows !== undefined
              ? t('database.mobile.affectedRows', '{{count}} affected rows', {
                  count: snapshot.record.affectedRows
                })
              : t('database.mobile.rowCount', '{{count}} rows', { count: snapshot.rowCount })}
          </Text>
          {snapshot.truncated ? (
            <Text style={styles.meta}>
              {t(
                'database.mobile.resultTruncated',
                'Result limited by the host. Refine the query to retrieve other rows.'
              )}
            </Text>
          ) : null}
        </View>
      ) : null}
      {snapshot.columns.length ? (
        <ScrollView horizontal style={styles.tableViewport} contentContainerStyle={{ width }}>
          <View style={[styles.tableCanvas, { width }]}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              {snapshot.columns.map((column) => (
                <View key={column.id} style={styles.tableCell}>
                  <Text numberOfLines={2} style={styles.title}>
                    {column.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.meta}>
                    {column.databaseType}
                  </Text>
                </View>
              ))}
            </View>
            <FlatList
              data={snapshot.rows}
              keyExtractor={(_, index) => String(index)}
              initialNumToRender={15}
              maxToRenderPerBatch={15}
              windowSize={5}
              renderItem={({ item, index }) => (
                <View style={styles.tableRow}>
                  {snapshot.columns.map((column, columnIndex) => (
                    <Pressable
                      key={column.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${column.name}, ${index + 1}: ${databaseCellText(item[columnIndex])}`}
                      onPress={() =>
                        setCell({ title: column.name, value: databaseCellText(item[columnIndex]) })
                      }
                      style={({ pressed }) => [styles.tableCell, pressed && styles.pressed]}
                    >
                      <Text numberOfLines={2} style={[styles.text, styles.mono]}>
                        {databaseCellText(item[columnIndex])}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.content}>
                  <Text style={styles.meta}>
                    {t('database.mobile.noRows', 'The query returned no rows.')}
                  </Text>
                </View>
              }
            />
          </View>
        </ScrollView>
      ) : null}
      <BottomDrawer visible={cell !== null} onClose={() => setCell(null)}>
        <SheetHeader title={cell?.title ?? ''} onClose={() => setCell(null)} />
        <Text selectable style={[styles.text, styles.mono]}>
          {cell?.value}
        </Text>
      </BottomDrawer>
    </View>
  )
}

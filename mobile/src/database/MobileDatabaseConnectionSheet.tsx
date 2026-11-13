import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Database } from 'lucide-react-native'
import type { DatabaseConnectionRef } from '../../../src/shared/database/database-contracts'
import { BottomDrawer } from '../components/bottom-drawer/BottomDrawer'
import { SheetHeader } from '../components/nav-bar/SheetHeader'
import { ListGroup, ListRow } from '../components/list/ListGroup'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { useMobileDatabaseConnections } from './use-mobile-database-connections'
import { databaseStyles as styles } from './mobile-database-styles'

type Props = {
  visible: boolean
  client: RpcClient | null
  worktreeId: string
  opening?: boolean
  error?: string
  onClose: () => void
  onSelect: (connection: DatabaseConnectionRef) => void
}

export function MobileDatabaseConnectionSheet(props: Props) {
  const t = useMobileTranslation()
  return (
    <BottomDrawer visible={props.visible} onClose={props.onClose}>
      <SheetHeader title={t('database.mobile.connections', 'Databases')} onClose={props.onClose} />
      {props.visible ? <Connections {...props} /> : null}
    </BottomDrawer>
  )
}

function Connections({ client, worktreeId, onSelect, opening, error }: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const state = useMobileDatabaseConnections(client, worktreeId)
  if (state.loading) {
    return <ActivityIndicator color={colors.textSecondary} />
  }
  if (state.error) {
    return (
      <View style={styles.notice}>
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error}
        </Text>
        <Pressable accessibilityRole="button" onPress={state.refresh} style={styles.button}>
          <Text style={styles.text}>{t('common.retry', 'Retry')}</Text>
        </Pressable>
      </View>
    )
  }
  if (!state.connections.length) {
    return (
      <Text style={styles.meta}>
        {t(
          'database.mobile.noConnections',
          'No database connections are linked to this project. Configure them in Orca on your computer.'
        )}
      </Text>
    )
  }
  return (
    <View>
      {opening ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text style={styles.meta}>{t('database.mobile.opening', 'Opening database…')}</Text>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <ListGroup>
        {state.connections.map((connection) => (
          <ListRow
            key={connection.id}
            title={connection.displayName || connection.alias}
            subtitle={[connection.environment, connection.engine].filter(Boolean).join(' · ')}
            leading={<Database size={16} color={colors.textSecondary} />}
            navigates
            busy={opening}
            onPress={() => {
              if (!state.controllerRuntimeId) {
                return
              }
              onSelect({
                connectionId: connection.id,
                controllerRuntimeId: state.controllerRuntimeId
              })
            }}
          />
        ))}
      </ListGroup>
    </View>
  )
}

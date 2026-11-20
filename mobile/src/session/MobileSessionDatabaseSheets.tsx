import { MobileDatabaseConnectionSheet } from '../database/MobileDatabaseConnectionSheet'
import { ActionSheetModal } from '../components/sheets/ActionSheetModal'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import type { MobileSessionController } from './use-mobile-session-controller'

/** The connection picker a new database tab opens from, and a database tab's actions. */
export function MobileSessionDatabaseSheets({
  controller
}: {
  controller: MobileSessionController
}) {
  const t = useMobileTranslation()
  return (
    <>
      <MobileDatabaseConnectionSheet
        visible={controller.showDatabaseConnections}
        opening={controller.creatingDatabase}
        error={controller.databaseCreateError}
        client={controller.client}
        worktreeId={controller.worktreeId}
        onClose={() => controller.setShowDatabaseConnections(false)}
        onSelect={(connection) => void controller.handleCreateDatabase(connection)}
      />
      <ActionSheetModal
        visible={controller.databaseActionTarget !== null}
        title={controller.databaseActionTarget?.title || t('session.sheets.database', 'Database')}
        actions={controller.closeWithBulkActions(controller.databaseActionTarget, () =>
          controller.setDatabaseActionTarget(null)
        )}
        onClose={() => controller.setDatabaseActionTarget(null)}
      />
    </>
  )
}

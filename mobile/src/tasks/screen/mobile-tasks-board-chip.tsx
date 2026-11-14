import { SquareKanban } from 'lucide-react-native'
import { useOptionalHostProtocolGates } from '../../components/host-protocol-gates-context'
import { FilterChip } from '../../components/nav-bar/FilterChip'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import type { RouteHandoff } from '../../navigation/route-handoff'
import { saveTasksSurface } from '../../storage/tasks-surface-preference'
import { hostServesTaskBoard, mobileTaskBoardHref } from '../mobile-task-navigation'

/** Switches Tasks to My board; absent until the host announces the board, since an older host's page has no board route. */
export function MobileTasksBoardChip({
  hostId,
  router
}: {
  hostId: string
  router: Pick<RouteHandoff, 'replace'>
}) {
  const t = useMobileTranslation()
  const gates = useOptionalHostProtocolGates()
  if (!hostServesTaskBoard(gates && !gates.statusPending ? gates.hostCapabilities : null)) {
    return null
  }
  return (
    <FilterChip
      label={t('tasks.providerControls.myBoard', 'My board')}
      icon={SquareKanban}
      onPress={() => {
        void saveTasksSurface(hostId, 'board').then(() =>
          router.replace(mobileTaskBoardHref(hostId))
        )
      }}
    />
  )
}

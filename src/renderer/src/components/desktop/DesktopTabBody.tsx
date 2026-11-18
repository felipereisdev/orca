import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/files/access/file-owner-runtime-target'
import { createNonSecureContextUuid } from '../../../../shared/identifiers/non-secure-context-uuid'
import { DesktopToolbar } from './DesktopToolbar'
import { DesktopViewer } from './DesktopViewer'
import { desktopErrorMessage } from './desktop-error-copy'
import { useDesktopSession, type DesktopActions, type DesktopView } from './use-desktop-session'

/** The Desktop tab without its data: the toolbar, the privacy notice and the viewer slot. */
export function DesktopTabLayout({
  view,
  busy,
  error,
  actions,
  viewer
}: {
  view: DesktopView
  busy: boolean
  error: string | null
  actions: DesktopActions
  viewer: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="absolute inset-0 flex min-h-0 flex-col bg-background">
      <DesktopToolbar
        view={view}
        busy={busy}
        error={error ? desktopErrorMessage(error, t) : null}
        actions={actions}
      />
      <p className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        <ShieldAlert className="size-3.5 shrink-0" />
        {t(
          'desktop.tab.notice',
          "Programs on the environment desktop can see what is shown and typed there. Don't type personal passwords here."
        )}
      </p>
      <div className="relative min-h-0 flex-1">
        {view.kind === 'ready' ? (
          viewer
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {view.kind === 'connecting'
              ? t('desktop.tab.status.connecting', 'Connecting…')
              : t('desktop.tab.unavailableBody', 'The environment desktop is not reachable.')}
          </div>
        )}
      </div>
    </div>
  )
}

/** A Desktop tab's pane body: a live view of the workspace environment's desktop. */
export function DesktopTabBody({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const target = useAppStore(
    useShallow((state) => getRuntimeTargetForWorktreeOwner(state, worktreeId))
  )
  const [viewerId] = useState(createNonSecureContextUuid)
  const session = useDesktopSession(target, viewerId)
  const viewOnly = session.view.kind !== 'ready' || session.view.owner !== 'user'
  return (
    <DesktopTabLayout
      view={session.view}
      busy={session.busy}
      error={session.error}
      actions={session.actions}
      viewer={
        target ? (
          <DesktopViewer
            key={session.connection}
            target={target}
            viewerId={viewerId}
            viewOnly={viewOnly}
            onLost={session.markLost}
          />
        ) : null
      }
    />
  )
}

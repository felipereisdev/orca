import { AppWindow, Bot, Circle, ClipboardPaste, Hand, Square, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { DesktopActions, DesktopView } from './use-desktop-session'

function RetryableChip({ label, onRetry }: { label: string; onRetry: () => void }) {
  const t = useTranslate()
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <Badge variant="warning">{label}</Badge>
      <Button variant="link" size="inlineText" onClick={onRetry}>
        {t('desktop.tab.retry', 'Try again')}
      </Button>
    </span>
  )
}

function StatusChip({ view, onRetry }: { view: DesktopView; onRetry: () => void }) {
  const t = useTranslate()
  if (view.kind === 'unavailable') {
    return (
      <RetryableChip label={t('desktop.tab.status.unavailable', 'Unavailable')} onRetry={onRetry} />
    )
  }
  if (view.kind === 'unconfigured') {
    return (
      <RetryableChip
        label={t('desktop.tab.status.unconfigured', 'Not set up yet')}
        onRetry={onRetry}
      />
    )
  }
  if (view.kind === 'connecting') {
    return <Badge variant="outline">{t('desktop.tab.status.connecting', 'Connecting…')}</Badge>
  }
  if (view.control === 'this') {
    return (
      <Badge variant="dot">
        <UserRound />
        {t('desktop.tab.status.user', "You're in control")}
      </Badge>
    )
  }
  if (view.control === 'other') {
    return (
      <Badge variant="outline">
        <AppWindow />
        {t('desktop.tab.status.otherWindow', 'Control in another window')}
      </Badge>
    )
  }
  return (
    <Badge variant="outline">
      <Bot />
      {t('desktop.tab.status.agent', 'Agent in control')}
    </Badge>
  )
}

/** The Desktop tab's toolbar: who holds the desktop, the control hand-off and recording. */
export function DesktopToolbar({
  view,
  busy,
  error,
  actions
}: {
  view: DesktopView
  busy: boolean
  error: string | null
  actions: DesktopActions
}): React.JSX.Element {
  const t = useTranslate()
  const ready = view.kind === 'ready'
  const mine = ready && view.control === 'this'
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
      <StatusChip view={view} onRetry={actions.retry} />
      {error ? (
        <span role="alert" className="min-w-0 truncate text-xs text-destructive">
          {error}
        </span>
      ) : null}
      {ready ? (
        <div className="ml-auto flex items-center gap-1.5">
          {mine && actions.paste ? (
            <Button variant="outline" size="xs" onClick={actions.paste}>
              <ClipboardPaste />
              {t('desktop.tab.paste', 'Paste text')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={view.recording ? actions.stopRecording : actions.startRecording}
          >
            {view.recording ? <Square /> : <Circle className="fill-destructive text-destructive" />}
            {view.recording
              ? t('desktop.tab.recording.stop', 'Stop recording')
              : t('desktop.tab.recording.start', 'Record')}
          </Button>
          <Button
            variant={mine ? 'outline' : 'default'}
            size="xs"
            disabled={busy}
            onClick={mine ? actions.handBack : actions.takeControl}
          >
            <Hand />
            {mine
              ? t('desktop.tab.control.handBack', 'Hand back to agent')
              : t('desktop.tab.control.take', 'Take control')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

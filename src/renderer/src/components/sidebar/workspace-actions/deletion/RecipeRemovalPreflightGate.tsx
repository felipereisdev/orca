import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { DialogCancel, DialogError, DialogWarning } from '@/components/ui/dialog-parts'
import { useTranslate } from '@/i18n/use-translate'
import type {
  RecipeRemovalCopyFailure,
  RecipeRemovalPreflight,
  RecipeRemovalTarget
} from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import {
  recipeRemovalCopyErrorText,
  recipeRemovalLossLines,
  recipeRemovalReasonText
} from './recipe-removal-preflight-copy'
import type { RecipeRemovalCandidate, RecipeRemovalResult } from './recipe-removal-preflights'
import { useRecipeRemovalPreflight } from './use-recipe-removal-preflight'

function RemoveFooter({
  busy,
  primaryCopy,
  onRemove,
  children
}: {
  busy: boolean
  primaryCopy: boolean
  onRemove: () => void
  children?: ReactNode
}): JSX.Element {
  const t = useTranslate()
  return (
    <DialogFooter>
      <DialogCancel disabled={busy}>
        {t('workspaceDeletion.recipeCheck.cancel', 'Cancel')}
      </DialogCancel>
      <Button
        size="sm"
        variant={primaryCopy ? 'outline' : 'destructive'}
        disabled={busy}
        onClick={onRemove}
      >
        {t('workspaceDeletion.recipeCheck.removeAnyway', 'Remove anyway')}
      </Button>
      {children}
    </DialogFooter>
  )
}

function PreflightSummary({ preflight }: { preflight: RecipeRemovalPreflight }): JSX.Element {
  const t = useTranslate()
  const lossLines = recipeRemovalLossLines(preflight, t)
  return (
    <>
      {preflight.status === 'unchecked' ? (
        <p className="text-[13px] text-muted-foreground">
          {recipeRemovalReasonText(preflight.reason, t)}
        </p>
      ) : null}
      {lossLines.length > 0 ? (
        <ul className="list-disc pl-5 text-[13px] text-muted-foreground">
          {lossLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function SingleWorkspacePanel({
  target,
  preflight: checked,
  onRemove,
  onBusyChange
}: {
  target: RecipeRemovalTarget
  preflight: RecipeRemovalPreflight
  onRemove: () => void
  onBusyChange?: (busy: boolean) => void
}): JSX.Element {
  const t = useTranslate()
  const [preflight, setPreflight] = useState(checked)
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState<RecipeRemovalCopyFailure | null>(null)
  // A dialog closed or retargeted during the copy must never remove afterwards.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      onBusyChange?.(false)
    }
  }, [onBusyChange])
  const canCopy = preflight.status === 'unsafe' && preflight.recordingsNotCopied.length > 0

  const copyAndRemove = async (): Promise<void> => {
    setCopying(true)
    onBusyChange?.(true)
    setCopyError(null)
    const result = await window.api.ephemeralVm
      .copyRecordingsBeforeRemoval(target)
      .catch(() => ({ ok: false as const, reason: 'unreachable' as const }))
    if (!mounted.current) {
      return
    }
    setCopying(false)
    onBusyChange?.(false)
    if (result.ok) {
      onRemove()
    } else if (result.reason === 'still_pending') {
      setPreflight(result.preflight)
    } else {
      setCopyError(result.reason)
    }
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5" data-recipe-removal-check={preflight.status}>
        <DialogWarning>
          {preflight.status === 'unchecked'
            ? t('workspaceDeletion.recipeCheck.uncheckedTitle', "Couldn't verify this workspace")
            : t(
                'workspaceDeletion.recipeCheck.unsafeTitle',
                'This workspace has work that is not safe yet:'
              )}
        </DialogWarning>
        <PreflightSummary preflight={preflight} />
      </div>
      {copyError ? <DialogError>{recipeRemovalCopyErrorText(copyError, t)}</DialogError> : null}
      <RemoveFooter busy={copying} primaryCopy={canCopy} onRemove={onRemove}>
        {canCopy ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={copying}
            onClick={() => void copyAndRemove()}
          >
            {copying
              ? t('workspaceDeletion.recipeCheck.copying', 'Copying recordings…')
              : t('workspaceDeletion.recipeCheck.copyAndRemove', 'Copy recordings and remove')}
          </Button>
        ) : null}
      </RemoveFooter>
    </>
  )
}

/** Several workspaces: one list of what each would lose, and only remove anyway or cancel. */
function AggregatePanel({
  results,
  onRemove
}: {
  results: RecipeRemovalResult[]
  onRemove: () => void
}): JSX.Element {
  const t = useTranslate()
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5" data-recipe-removal-check="aggregate">
        <DialogWarning>
          {t(
            'workspaceDeletion.recipeCheck.aggregateTitle',
            'Some of these workspaces have work that is not safe yet:'
          )}
        </DialogWarning>
        {results.map(({ candidate, preflight }) => (
          <div key={`${candidate.hostId}\0${candidate.id}`} className="min-w-0">
            <p className="text-[13px] font-medium break-words text-foreground">
              {candidate.displayName}
              {preflight.status === 'unchecked'
                ? ` — ${t('workspaceDeletion.recipeCheck.uncheckedTitle', "Couldn't verify this workspace")}`
                : null}
            </p>
            <PreflightSummary preflight={preflight} />
          </div>
        ))}
      </div>
      <RemoveFooter busy={false} primaryCopy={false} onRemove={onRemove} />
    </>
  )
}

/**
 * Before recipe workspaces are removed, checks what the removal would lose. A clean answer, or
 * workspaces the check doesn't apply to, show `children` (today's footer) unchanged.
 */
export function RecipeRemovalPreflightGate({
  targets,
  checkAll = false,
  onRemove,
  onBusyChange,
  children
}: {
  /** Null while the dialog is closed. */
  targets: readonly RecipeRemovalCandidate[] | null
  /** Ask about every hosted workspace, for removals already known to destroy a recipe VM. */
  checkAll?: boolean
  onRemove: () => void
  /** True while recordings are copied, so the dialog can't be dismissed mid-copy. */
  onBusyChange?: (busy: boolean) => void
  children: ReactNode
}): JSX.Element {
  const t = useTranslate()
  const check = useRecipeRemovalPreflight(targets, checkAll)
  if (check.kind === 'skip') {
    return <>{children}</>
  }
  if (check.kind === 'loading') {
    return (
      <>
        <p className="text-[13px] text-muted-foreground" data-recipe-removal-check="loading">
          {t('workspaceDeletion.recipeCheck.checking', 'Checking this workspace for unsaved work…')}
        </p>
        <DialogFooter>
          <DialogCancel>{t('workspaceDeletion.recipeCheck.cancel', 'Cancel')}</DialogCancel>
          <Button size="sm" variant="destructive" disabled>
            {t('workspaceDeletion.recipeCheck.checkingButton', 'Checking…')}
          </Button>
        </DialogFooter>
      </>
    )
  }
  const notClean = check.results.filter((result) => result.preflight.status !== 'clean')
  if (notClean.length === 0) {
    return <>{children}</>
  }
  if (targets?.length === 1 && notClean.length === 1) {
    const [only] = notClean
    return (
      <SingleWorkspacePanel
        key={`${only.target.hostId}\0${only.target.workspaceId}`}
        target={only.target}
        preflight={only.preflight}
        onRemove={onRemove}
        onBusyChange={onBusyChange}
      />
    )
  }
  return <AggregatePanel results={notClean} onRemove={onRemove} />
}

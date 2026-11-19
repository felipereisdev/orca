import { useState, type JSX, type ReactNode } from 'react'
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
import { useRecipeRemovalPreflight } from './use-recipe-removal-preflight'

function RecipeRemovalPreflightPanel({
  target,
  preflight,
  onRemove
}: {
  target: RecipeRemovalTarget
  preflight: RecipeRemovalPreflight
  onRemove: () => void
}): JSX.Element {
  const t = useTranslate()
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState<RecipeRemovalCopyFailure | null>(null)
  const canCopy = preflight.status === 'unsafe' && preflight.recordingsNotCopied.length > 0
  const lossLines = recipeRemovalLossLines(preflight, t)

  const copyAndRemove = async (): Promise<void> => {
    setCopying(true)
    setCopyError(null)
    const result = await window.api.ephemeralVm
      .copyRecordingsBeforeRemoval(target)
      .catch(() => ({ ok: false as const, reason: 'unreachable' as const }))
    setCopying(false)
    if (result.ok) {
      onRemove()
    } else {
      setCopyError(result.reason)
    }
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5" data-recipe-removal-check={preflight.status}>
        <DialogWarning>
          {preflight.status === 'unsafe'
            ? t(
                'workspaceDeletion.recipeCheck.unsafeTitle',
                'This workspace has work that is not safe yet:'
              )
            : t('workspaceDeletion.recipeCheck.uncheckedTitle', "Couldn't verify this workspace")}
        </DialogWarning>
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
      </div>
      {copyError ? <DialogError>{recipeRemovalCopyErrorText(copyError, t)}</DialogError> : null}
      <DialogFooter>
        <DialogCancel disabled={copying}>
          {t('workspaceDeletion.recipeCheck.cancel', 'Cancel')}
        </DialogCancel>
        <Button
          size="sm"
          variant={canCopy ? 'outline' : 'destructive'}
          disabled={copying}
          onClick={onRemove}
        >
          {t('workspaceDeletion.recipeCheck.removeAnyway', 'Remove anyway')}
        </Button>
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
      </DialogFooter>
    </>
  )
}

/**
 * Before a recipe workspace is removed, checks what the removal would lose. A clean answer, or a
 * workspace the check doesn't apply to, shows `children` (today's footer) unchanged.
 */
export function RecipeRemovalPreflightGate({
  workspaceId,
  onRemove,
  children
}: {
  /** Null while the dialog is closed or removes several workspaces. */
  workspaceId: string | null
  onRemove: () => void
  children: ReactNode
}): JSX.Element {
  const t = useTranslate()
  const check = useRecipeRemovalPreflight(workspaceId)
  if (check.kind === 'skip' || (check.kind === 'done' && check.preflight.status === 'clean')) {
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
  return (
    <RecipeRemovalPreflightPanel
      target={check.target}
      preflight={check.preflight}
      onRemove={onRemove}
    />
  )
}

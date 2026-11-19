import type { JSX, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { DialogCancel } from '@/components/ui/dialog-parts'
import { useTranslate } from '@/i18n/use-translate'
import type { RecipeRemovalCandidate } from '@/runtime/ephemeral-vm/recipe-removal-preflights'
import { RecipeRemovalResultsPanel } from './RecipeRemovalPanels'
import { useRecipeRemovalPreflight } from './use-recipe-removal-preflight'

/**
 * Before recipe workspaces are removed, checks what the removal would lose. A clean answer, or
 * workspaces no recipe owns, show `children` (today's footer) unchanged.
 */
export function RecipeRemovalPreflightGate({
  targets,
  onRemove,
  onBusyChange,
  children
}: {
  /** Null while the dialog is closed. */
  targets: readonly RecipeRemovalCandidate[] | null
  onRemove: () => void
  /** True while recordings are copied, so the dialog can't be dismissed mid-copy. */
  onBusyChange?: (busy: boolean) => void
  children: ReactNode
}): JSX.Element {
  const t = useTranslate()
  const check = useRecipeRemovalPreflight(targets)
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
  if (
    check.kind === 'skip' ||
    check.results.every((result) => result.preflight.status === 'clean')
  ) {
    return <>{children}</>
  }
  return (
    <RecipeRemovalResultsPanel
      results={check.results}
      single={targets?.length === 1}
      onRemove={onRemove}
      onBusyChange={onBusyChange}
    />
  )
}

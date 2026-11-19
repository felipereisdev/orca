import { useState, useSyncExternalStore, type JSX } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import {
  getRecipeRemovalReview,
  subscribeRecipeRemovalReview
} from '@/runtime/ephemeral-vm/recipe-removal-review'
import { RecipeRemovalResultsPanel } from './RecipeRemovalPanels'

/**
 * Removals that run without the delete dialog (project removal, a host's workspaces, a Cloud VM)
 * show here what they would lose before the recipe environment is destroyed.
 */
export function RecipeRemovalReviewDialog(): JSX.Element | null {
  const t = useTranslate()
  const review = useSyncExternalStore(subscribeRecipeRemovalReview, getRecipeRemovalReview)
  const [copying, setCopying] = useState(false)
  if (!review) {
    return null
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !copying) {
          review.settle(null)
        }
      }}
    >
      <DialogContent size="confirm" surface="security" busy={copying} initialFocus="cancel">
        <DialogHeader>
          <DialogTitle>
            {t('workspaceDeletion.recipeCheck.reviewTitle', 'Review before removing')}
          </DialogTitle>
        </DialogHeader>
        <RecipeRemovalResultsPanel
          results={review.results}
          single={review.single}
          onRemove={(acks) => review.settle(acks)}
          onBusyChange={setCopying}
        />
      </DialogContent>
    </Dialog>
  )
}

export default RecipeRemovalReviewDialog

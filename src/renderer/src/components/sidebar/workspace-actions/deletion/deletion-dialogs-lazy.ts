import { lazy } from 'react'

// Why lazy: both dialogs open only on a workspace removal, so they stay out of the startup bundle.
export const DeleteWorktreeDialog = lazy(() => import('./DeleteWorktreeDialog'))
export const RecipeRemovalReviewDialog = lazy(() => import('./RecipeRemovalReviewDialog'))

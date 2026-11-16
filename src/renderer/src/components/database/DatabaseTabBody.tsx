import { lazy, Suspense } from 'react'

const WorkspaceDatabaseExplorer = lazy(() => import('./WorkspaceDatabaseExplorer'))

/** A database tab's pane body; the explorer loads on first open. */
export function DatabaseTabBody({
  worktreeId,
  entityId
}: {
  worktreeId: string
  entityId: string
}): React.JSX.Element {
  return (
    <div className="absolute inset-0">
      <Suspense fallback={null}>
        <WorkspaceDatabaseExplorer worktreeId={worktreeId} entityId={entityId} />
      </Suspense>
    </div>
  )
}

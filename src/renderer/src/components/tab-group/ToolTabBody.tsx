import type React from 'react'
import { DatabaseTabBody } from '../database/DatabaseTabBody'
import { DesktopTabBody } from '../desktop/DesktopTabBody'

/** The body of a tab that holds a tool rather than a file: a database connection or the desktop. */
export function ToolTabBody({
  tab,
  worktreeId
}: {
  tab: { contentType: string; entityId: string } | null | undefined
  worktreeId: string
}): React.JSX.Element | null {
  if (tab?.contentType === 'database') {
    return <DatabaseTabBody worktreeId={worktreeId} entityId={tab.entityId} />
  }
  return tab?.contentType === 'desktop' ? <DesktopTabBody worktreeId={worktreeId} /> : null
}

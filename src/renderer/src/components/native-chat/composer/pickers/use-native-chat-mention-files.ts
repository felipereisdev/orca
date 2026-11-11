import {
  useNativeChatDatabaseMentions,
  type NativeChatDatabaseMention
} from './use-native-chat-database-mentions'
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useRuntimeFileListForWorktree } from '@/components/quick-open-file-list'
import { rankQuickOpenFilesWithHistory } from '@/components/quick-open-history-ranking'
import { useQuickOpenHistory } from '@/lib/files/search/quick-open-file-history'
import { chatWorkspaceByTabId as findTerminalTabWorktreeId } from '../../../../lib/structured-chat-tab-index'
import { useFileListWorktree } from '@/store/workspaces/selection/use-selected-worktree'

const MENTION_FILE_LIMIT = 20
const NO_FILES: readonly string[] = []

export type NativeChatMentionFiles = {
  /** Workspace-relative paths, best match first. */
  files: readonly string[]
  loading: boolean
  failed: boolean
  databases?: NativeChatDatabaseMention[]
  databasesLoading?: boolean
  databasesError?: string
}

/** `query` is null while no `@` token is open. */
export function useNativeChatMentionFiles(args: {
  query: string | null
  terminalTabId: string
  structuredWorktreeId?: string
}): NativeChatMentionFiles {
  const { query, terminalTabId, structuredWorktreeId } = args
  const enabled = query !== null
  // Closed is the common state, so the tab scan only runs while a token is open.
  const worktreeId = useAppStore((state) =>
    enabled
      ? (structuredWorktreeId ?? findTerminalTabWorktreeId(state.tabsByWorktree, terminalTabId))
      : null
  )
  const databases = useNativeChatDatabaseMentions(structuredWorktreeId, query)
  const worktreePath = useFileListWorktree(worktreeId)?.path ?? null
  const history = useQuickOpenHistory(worktreeId, worktreePath)
  const list = useRuntimeFileListForWorktree({
    enabled,
    worktreeId,
    query: query ?? '',
    recentPaths: history
  })
  const failed = list.loadError !== null

  return useMemo(
    () => ({
      files:
        query === null
          ? NO_FILES
          : rankQuickOpenFilesWithHistory(query, list.files, history)
              .slice(0, MENTION_FILE_LIMIT)
              .map((item) => item.path),
      loading: list.loading,
      failed,
      ...databases
    }),
    [failed, history, list.files, list.loading, query, databases]
  )
}

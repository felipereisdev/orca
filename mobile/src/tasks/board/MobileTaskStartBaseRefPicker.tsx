import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Search } from 'lucide-react-native'
import { legacyBaseRefSearchResult } from '../../../../src/shared/worktree/base-refs/base-ref-search-result'
import { branchRefLabel, branchRefLabels } from '../../../../src/shared/git/refs/branch-ref-label'
import { BottomDrawer } from '../../components/bottom-drawer/BottomDrawer'
import { TextField } from '../../components/composer-input/TextField'
import { ListGroup, ListRow } from '../../components/list/ListGroup'
import { SheetHeader } from '../../components/nav-bar/SheetHeader'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { repoBaseRefSearchRead } from '../../source-control/branches/mobile-repo-base-ref-operations'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { colors, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

type BaseRefSearch = { refs: string[]; loading: boolean; error: string | null }

const NO_SEARCH: BaseRefSearch = { refs: [], loading: false, error: null }

/** The repository's refs matching `query`, read from its host as the workspace picker does. */
function useBaseRefSearch(client: RpcClient | null, repoId: string, query: string): BaseRefSearch {
  const [search, setSearch] = useState<BaseRefSearch>(NO_SEARCH)
  const trimmed = query.trim()
  useEffect(() => {
    if (!client || !trimmed) {
      setSearch(NO_SEARCH)
      return
    }
    let current = true
    setSearch((previous) => ({ ...previous, loading: true, error: null }))
    repoBaseRefSearchRead
      .request(client, { repo: `id:${repoId}`, query: trimmed, limit: 20 }, { timeoutMs: 30_000 })
      .then((reply) => {
        const result = repoBaseRefSearchRead.interpret(reply)
        const details = result.refDetails ?? (result.refs ?? []).map(legacyBaseRefSearchResult)
        if (current) {
          setSearch({ refs: details.map((detail) => detail.refName), loading: false, error: null })
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setSearch({
            refs: [],
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause)
          })
        }
      })
    return () => {
      current = false
    }
  }, [client, repoId, trimmed])
  return search
}

/** The base branch for this start: the repository's default, or a ref found by search. */
export function MobileTaskStartBaseRefPicker({
  visible,
  client,
  repoId,
  defaultRef,
  selected,
  zIndex,
  onSelect,
  onClose
}: {
  visible: boolean
  client: RpcClient | null
  repoId: string
  defaultRef: string | null
  /** Undefined: the repository's default. */
  selected: string | undefined
  zIndex: number
  onSelect: (baseRef: string | undefined) => void
  onClose: () => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [query, setQuery] = useState('')
  const search = useBaseRefSearch(visible ? client : null, repoId, query)
  const labels = branchRefLabels(search.refs)
  const pick = (baseRef: string | undefined): void => {
    onSelect(baseRef)
    onClose()
  }
  return (
    <BottomDrawer visible={visible} onClose={onClose} zIndex={zIndex}>
      <SheetHeader title={t('tasks.board.start.baseBranch', 'Base branch')} onClose={onClose} />
      <View style={styles.stack}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('tasks.board.start.searchBranches', 'Search branches')}
          leading={<Search size={16} color={colors.textMuted} />}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ListGroup>
          <ListRow
            key="default"
            title={t('tasks.board.start.baseBranchDefault', 'Default for this repository')}
            subtitle={defaultRef ?? undefined}
            selected={selected === undefined}
            onPress={() => pick(undefined)}
          />
          {search.refs.map((ref) => (
            <ListRow
              key={ref}
              title={labels.get(ref) ?? branchRefLabel(ref)}
              selected={selected === ref}
              onPress={() => pick(ref)}
            />
          ))}
        </ListGroup>
        {search.loading ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : search.error ? (
          <Text style={styles.problem}>{search.error}</Text>
        ) : query.trim() && search.refs.length === 0 ? (
          <Text style={styles.muted}>
            {t('tasks.board.start.noBranches', 'No branches match.')}
          </Text>
        ) : null}
      </View>
    </BottomDrawer>
  )
}

const styles = themedStyleSheet(() => ({
  stack: {
    gap: spacing.md,
    paddingBottom: spacing.sm
  },
  problem: {
    fontSize: typography.metaSize,
    color: colors.statusRed
  },
  muted: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  }
}))

import { Pressable, Text, View } from 'react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { TaskBoardStage } from './task-board-stages'

/** A tile per stage with work under way: how many cards, and how many have comments not yet seen. */
export function MobileTaskBoardSummary({
  stages,
  onSelect
}: {
  stages: readonly TaskBoardStage[]
  onSelect: (stageId: string) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const started = stages.filter((stage) => stage.started)
  if (started.length === 0) {
    return null
  }
  return (
    <View style={styles.row}>
      {started.map((stage) => {
        const unread =
          stage.withUnread === 0
            ? t('tasks.board.summary.noNewComments', 'No new comments')
            : stage.withUnread === 1
              ? t('tasks.board.summary.newComments_one', '{{count}} with new comments', {
                  count: stage.withUnread
                })
              : t('tasks.board.summary.newComments_other', '{{count}} with new comments', {
                  count: stage.withUnread
                })
        return (
          <Pressable
            key={stage.id}
            onPress={() => onSelect(stage.id)}
            accessibilityRole="button"
            accessibilityLabel={`${stage.label}, ${String(stage.cards.length)}, ${unread}`}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          >
            <Text style={styles.label} numberOfLines={1}>
              {stage.label}
            </Text>
            <Text style={styles.count}>{stage.cards.length}</Text>
            <View style={styles.unreadRow}>
              {stage.withUnread > 0 ? <View style={styles.dot} /> : null}
              <Text
                style={[styles.unread, stage.withUnread > 0 && styles.unreadActive]}
                numberOfLines={1}
              >
                {unread}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  tile: {
    flex: 1,
    minWidth: 0,
    padding: spacing.md,
    gap: 2,
    borderRadius: radii.surface,
    backgroundColor: colors.bgPanel
  },
  pressed: {
    backgroundColor: colors.bgRaised
  },
  label: {
    fontSize: typography.metaSize,
    fontWeight: '500',
    color: colors.textSecondary
  },
  count: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.accentBlue
  },
  unread: {
    flexShrink: 1,
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  unreadActive: {
    color: colors.textSecondary
  }
}))

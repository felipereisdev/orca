import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'

export const cardStyles = themedStyleSheet(() => ({
  card: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.surface,
    backgroundColor: colors.bgPanel
  },
  pressed: {
    backgroundColor: colors.bgRaised
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  displayId: {
    flexShrink: 1,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  priority: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.cardPillFill,
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    overflow: 'hidden'
  },
  headerSpacer: {
    flex: 1
  },
  updatedAt: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    color: colors.textPrimary
  },
  meta: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  steps: {
    flexDirection: 'row',
    gap: spacing.xs
  },
  step: {
    flex: 1,
    gap: spacing.xs
  },
  stepBar: {
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.bgRaised
  },
  stepDone: {
    backgroundColor: colors.accentBlue
  },
  stepFailed: {
    backgroundColor: colors.statusRed
  },
  stepLabel: {
    fontSize: 11,
    color: colors.textMuted
  },
  stepLabelDone: {
    color: colors.textPrimary
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  branch: {
    flex: 1,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  checks: {
    fontSize: typography.metaSize,
    fontWeight: '500'
  },
  comment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  avatarInitial: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textSecondary
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  commentByline: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  commentAuthor: {
    fontWeight: '600',
    color: colors.textSecondary
  },
  commentExcerpt: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary
  },
  unread: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accentBlue,
    fontSize: 11,
    fontWeight: '600',
    color: colors.onAccent,
    overflow: 'hidden'
  }
}))

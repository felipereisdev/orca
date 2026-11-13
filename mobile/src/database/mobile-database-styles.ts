import { colors, feedback, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'

export const databaseStyles = themedStyleSheet(() => ({
  pane: { flex: 1, minHeight: 0, backgroundColor: colors.bgBase },
  body: { flex: 1, minHeight: 0 },
  content: { padding: spacing.lg, gap: spacing.md },
  compactContent: { padding: spacing.sm },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: typography.bodySize, fontWeight: '600', color: colors.textPrimary },
  text: { fontSize: typography.bodySize, color: colors.textPrimary },
  meta: { fontSize: typography.metaSize, color: colors.textSecondary },
  mono: { fontFamily: typography.monoFamily },
  error: { fontSize: typography.bodySize, color: colors.statusRed },
  notice: {
    padding: spacing.md,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.control,
    gap: spacing.sm
  },
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.control
  },
  primary: { backgroundColor: colors.surfaceBright },
  primaryText: { fontSize: typography.bodySize, fontWeight: '600', color: colors.bgBase },
  secondary: { backgroundColor: colors.bgRaised },
  disabled: { opacity: feedback.disabledOpacity },
  pressed: { opacity: feedback.pressedOpacity },
  editor: {
    minHeight: 110,
    maxHeight: 200,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.control,
    backgroundColor: colors.editorSurface,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontFamily: typography.monoFamily,
    textAlignVertical: 'top'
  },
  compactEditor: { minHeight: 64, maxHeight: 96 },
  separator: { height: 1, backgroundColor: colors.borderSubtle },
  tableRow: {
    flexDirection: 'row',
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  tableCell: {
    width: 160,
    padding: spacing.sm,
    borderRightWidth: 1,
    borderRightColor: colors.borderSubtle,
    justifyContent: 'center'
  },
  tableHeader: { backgroundColor: colors.bgRaised },
  tableViewport: { flex: 1, minHeight: 0 },
  tableCanvas: { flex: 1 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md
  },
  historyRow: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  }
}))

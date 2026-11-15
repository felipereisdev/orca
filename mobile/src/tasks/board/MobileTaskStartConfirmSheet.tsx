import { Text, View } from 'react-native'
import { SheetHeader } from '../../components/nav-bar/SheetHeader'
import { SheetPrimaryButton } from '../../components/SheetPrimaryButton'
import { colors, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

/** One question before a start or a stop: what happens, why, and the one action that goes ahead. */
export function MobileTaskStartConfirmSheet({
  title,
  description,
  details,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string
  description: string
  details?: readonly string[]
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  useMobileColorScheme()
  return (
    <>
      <SheetHeader title={title} onClose={onClose} />
      <View style={styles.body}>
        <Text style={styles.description}>{description}</Text>
        {details?.map((detail) => (
          <Text key={detail} style={styles.detail}>
            {`• ${detail}`}
          </Text>
        ))}
      </View>
      <View style={styles.footer}>
        <SheetPrimaryButton label={confirmLabel} onPress={onConfirm} />
      </View>
    </>
  )
}

const styles = themedStyleSheet(() => ({
  body: {
    gap: spacing.sm,
    paddingBottom: spacing.md
  },
  description: {
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  detail: {
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  footer: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm
  }
}))

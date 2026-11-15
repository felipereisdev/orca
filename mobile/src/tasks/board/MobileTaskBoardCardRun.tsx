import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import {
  CircleAlert,
  CircleCheck,
  CircleStop,
  LoaderCircle,
  MessageCircleQuestion,
  Play,
  Square
} from 'lucide-react-native'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import {
  isTaskStartRunExclusive,
  type TaskStartRunSummary
} from '../../../../src/shared/task-board/task-start-run'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import {
  taskStartDevelopmentDetail,
  taskStartPhaseLabel,
  taskStartRunHint,
  taskStartRunTone,
  taskStartSideState,
  taskStartStatusText,
  type RunTone
} from './task-board-run-labels'

/** What a card can do with its run; null on a host without task start. */
export type TaskBoardRunActions = {
  pendingRefKeys: ReadonlySet<string>
  onStart: (card: TaskBoardWireCard) => void
  onStop: (card: TaskBoardWireCard) => void
  onOpenRun: (card: TaskBoardWireCard) => void
}

// Read at render: the palette changes with the color scheme.
function toneColor(tone: RunTone): string {
  switch (tone) {
    case 'working':
      return colors.statusAmber
    case 'attention':
    case 'destructive':
      return colors.statusRed
    case 'success':
      return colors.statusGreen
    case 'muted':
      return colors.textMuted
  }
}

/** ▶︎ while the card has no exclusive run; ⏹ while one runs (again while stopping). */
export function CardRunButton({
  card,
  pending,
  onStart,
  onStop
}: {
  card: TaskBoardWireCard
  pending: boolean
  onStart: () => void
  onStop: () => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  if (pending) {
    return (
      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel={t('tasks.board.start.pending', 'Working on {{id}}…', {
          id: card.displayId
        })}
        accessibilityState={{ disabled: true, busy: true }}
        style={styles.button}
      >
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </Pressable>
    )
  }
  const run = card.taskStart
  const running = run ? isTaskStartRunExclusive(run) : false
  const label = running
    ? run?.state === 'stopping'
      ? t('tasks.board.start.stopAgain', 'Stop {{id}} again', { id: card.displayId })
      : t('tasks.board.start.stop', 'Stop {{id}}', { id: card.displayId })
    : t('tasks.board.start.start', 'Start {{id}}', { id: card.displayId })
  const Icon = running ? Square : Play
  return (
    <Pressable
      onPress={running ? onStop : onStart}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.sm}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon size={15} color={colors.textSecondary} />
    </Pressable>
  )
}

function RunIcon({ tone, run }: { tone: RunTone; run: TaskStartRunSummary }) {
  const color = toneColor(tone)
  const Icon =
    tone === 'attention'
      ? MessageCircleQuestion
      : tone === 'success'
        ? CircleCheck
        : tone === 'destructive'
          ? CircleAlert
          : run.state === 'stopped'
            ? CircleStop
            : LoaderCircle
  return <Icon size={13} color={color} />
}

/** The run's phase and percent over a thin bar; a tap opens the orchestrator's session. */
export function CardRunProgress({ run, onOpen }: { run: TaskStartRunSummary; onOpen: () => void }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const tone = taskStartRunTone(run)
  const side = taskStartSideState(run, t)
  const phase = taskStartPhaseLabel(run.phase, t)
  const detail = [side ? phase : null, taskStartDevelopmentDetail(run, t)]
    .filter(Boolean)
    .join(' · ')
  const hint = taskStartRunHint(run, t)
  const percent = Math.min(100, Math.max(0, run.percent))
  return (
    <Pressable
      onPress={onOpen}
      disabled={!(run.orchestrator?.worktreeId ?? run.worktreeId)}
      accessibilityRole="button"
      accessibilityLabel={t(
        'tasks.board.start.openRun',
        'Open the orchestrator: {{status}}, {{percent}}%',
        { status: taskStartStatusText(run, t), percent: run.percent }
      )}
      style={({ pressed }) => [
        styles.run,
        tone === 'attention' && styles.attention,
        pressed && styles.pressed
      ]}
    >
      <View style={styles.runRow}>
        <RunIcon tone={tone} run={run} />
        <Text
          style={[styles.runLabel, tone === 'attention' && { color: toneColor(tone) }]}
          numberOfLines={1}
        >
          {side ?? phase}
        </Text>
        <Text style={styles.runDetail} numberOfLines={1}>
          {detail}
        </Text>
        <Text style={styles.percent}>{`${run.percent}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: toneColor(tone) }]} />
      </View>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  )
}

const styles = themedStyleSheet(() => ({
  button: {
    width: 28,
    height: 28,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pressed: {
    backgroundColor: colors.bgRaised
  },
  run: {
    gap: spacing.xs,
    borderRadius: radii.mark
  },
  attention: {
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: colors.statusRed
  },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  runLabel: {
    flexShrink: 0,
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  runDetail: {
    flex: 1,
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  percent: {
    fontSize: typography.metaSize,
    fontVariant: ['tabular-nums'],
    color: colors.textMuted
  },
  track: {
    height: 4,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.bgRaised
  },
  fill: {
    height: 4,
    borderRadius: radii.pill
  },
  hint: {
    fontSize: 11,
    color: colors.textMuted
  }
}))

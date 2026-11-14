import { Text, View } from 'react-native'
import { Monitor } from 'lucide-react-native'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import type { WorkspaceStatusDefinition } from '../../../../src/shared/worktree/types'
import { MessageBox } from '../../components/composer-input/MessageBox'
import { ListGroup, ListRow, SectionHeader } from '../../components/list/ListGroup'
import { MobileStateView } from '../../components/MobileStateView'
import { SheetHeader } from '../../components/nav-bar/SheetHeader'
import { SheetPrimaryButton } from '../../components/SheetPrimaryButton'
import type { Translate } from '../../i18n/mobile-i18n'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { colors, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import {
  useTaskBoardMove,
  type BlockedReason,
  type TaskBoardMoveProblem,
  type TaskBoardMoveStep
} from './use-task-board-move'

type Props = {
  card: TaskBoardWireCard
  columns: readonly WorkspaceStatusDefinition[]
  client: RpcClient | null
  offline: boolean
  onMoved: (targetColumnId: string, moved: TaskBoardWireCard | null) => void
  onUnconfirmed: () => void
  onClose: () => void
}

function blockedText(reason: BlockedReason, t: Translate): string {
  switch (reason) {
    case 'no-mapping':
      return t('tasks.board.move.noMapping', 'No status is mapped to this column.')
    case 'no-transition':
      return t(
        'tasks.board.move.noTransition',
        "This task can't move to that column from its current status."
      )
    case 'same-column':
      return t('tasks.board.move.sameColumn', 'The task is already in this column.')
    case 'invalid-choice':
      return t(
        'tasks.board.move.invalidChoice',
        'That transition is no longer available. Pick the column again.'
      )
  }
}

function problemText(problem: TaskBoardMoveProblem, t: Translate): string {
  switch (problem.kind) {
    case 'blocked':
      return blockedText(problem.reason, t)
    case 'failed':
      return t('tasks.board.move.failed', "Couldn't move the task: {{error}}", {
        error: problem.error
      })
    case 'unconfirmed':
      return t(
        'tasks.board.move.unconfirmed',
        "Couldn't confirm the move ({{error}}). The board is reading where the task is now.",
        { error: problem.error }
      )
  }
}

/** The fields a needs-fields reply asks for; only a filled required field lets the move go. */
function MoveFields({
  step,
  onResolution,
  onComment
}: {
  step: Extract<TaskBoardMoveStep, { kind: 'fields' }>
  onResolution: (id: string) => void
  onComment: (text: string) => void
}) {
  const t = useMobileTranslation()
  const fields = typeof step.choice.fields === 'object' ? step.choice.fields : null
  const resolution = fields?.resolution ?? null
  return (
    <>
      {resolution ? (
        <>
          <SectionHeader
            title={resolution.name ?? t('tasks.board.move.resolution', 'Resolution')}
            trailing={resolution.required ? t('tasks.board.move.required', 'Required') : undefined}
            first
          />
          <ListGroup>
            {resolution.options.map((option) => (
              <ListRow
                key={option.id}
                title={option.name}
                selected={option.id === step.resolutionId}
                onPress={() => onResolution(option.id)}
              />
            ))}
          </ListGroup>
        </>
      ) : null}
      {fields?.commentRequired ? (
        <>
          <SectionHeader
            title={t('tasks.board.move.comment', 'Comment')}
            trailing={t('tasks.board.move.required', 'Required')}
          />
          <MessageBox
            value={step.comment}
            onChangeText={onComment}
            placeholder={t('tasks.board.move.commentPlaceholder', 'Add a comment')}
            accessibilityLabel={t('tasks.board.move.comment', 'Comment')}
          />
        </>
      ) : null}
    </>
  )
}

/** Move a card to another column: the host decides which columns it can reach and how. */
export function MobileTaskBoardMoveSheet({
  card,
  columns,
  client,
  offline,
  onMoved,
  onUnconfirmed,
  onClose
}: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const move = useTaskBoardMove({ client, offline, card, onMoved, onUnconfirmed })
  const { step } = move
  const title = t('tasks.board.move.title', 'Move {{id}}', { id: card.displayId })

  if (step.kind === 'unsupported') {
    const names = step.choice.unsupportedFieldNames ?? []
    return (
      <>
        <SheetHeader title={title} onClose={onClose} />
        <MobileStateView
          icon={Monitor}
          title={t('tasks.board.move.finishElsewhere', 'Finish this move on the desktop or web')}
          message={
            names.length > 0
              ? t('tasks.board.move.unsupportedFields', '{{transition}} needs {{fields}}.', {
                  transition: step.choice.name,
                  fields: names.join(', ')
                })
              : null
          }
        />
      </>
    )
  }

  const targets = columns
    .filter((column) => column.id !== card.columnId)
    .map((column) => ({
      column,
      // A column the host sent no verdict for is one it cannot place the card in.
      target: card.moveTargets.find((candidate) => candidate.columnId === column.id) ?? null
    }))
  return (
    <>
      <SheetHeader
        title={title}
        subtitle={card.title}
        leading={
          step.kind === 'targets'
            ? undefined
            : { label: t('common.back', 'Back'), onPress: move.back, disabled: move.busy }
        }
        onClose={onClose}
      />
      {step.kind === 'targets' ? (
        <ListGroup>
          {targets.map(({ column, target }) => (
            <ListRow
              key={column.id}
              title={column.label}
              subtitle={
                target?.allowed
                  ? undefined
                  : t('tasks.board.move.noMapping', 'No status is mapped to this column.')
              }
              disabled={!target?.allowed}
              selected={column.id === step.targetId}
              onPress={() => move.pickTarget(column.id)}
            />
          ))}
        </ListGroup>
      ) : null}
      {step.kind === 'choice' ? (
        <>
          <SectionHeader title={t('tasks.board.move.choose', 'Choose a transition')} first />
          <ListGroup>
            {step.choices.map((choice) => (
              <ListRow
                key={choice.id}
                title={choice.name}
                selected={choice.id === step.choiceId}
                onPress={() => move.pickChoice(choice.id)}
              />
            ))}
          </ListGroup>
        </>
      ) : null}
      {step.kind === 'fields' ? (
        <MoveFields step={step} onResolution={move.pickResolution} onComment={move.editComment} />
      ) : null}
      <View style={styles.footer}>
        {offline ? (
          <Text style={styles.note}>
            {t('tasks.board.move.offline', 'Moving a task needs the host. Reconnect to move it.')}
          </Text>
        ) : null}
        {move.problem ? <Text style={styles.problem}>{problemText(move.problem, t)}</Text> : null}
        <SheetPrimaryButton
          label={t('tasks.board.move.confirm', 'Move')}
          onPress={move.confirm}
          disabled={!move.ready || offline}
          busy={move.busy}
        />
      </View>
    </>
  )
}

const styles = themedStyleSheet(() => ({
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  note: {
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  problem: {
    fontSize: typography.metaSize,
    color: colors.statusAmber
  }
}))

import { useState } from 'react'
import { Text, View } from 'react-native'
import { branchRefLabel } from '../../../../src/shared/git/refs/branch-ref-label'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import {
  TASK_START_ROLES,
  type TaskStartRole,
  type TaskStartRoles,
  type TaskStartWorkspaceMode
} from '../../../../src/shared/task-board/task-start-settings'
import { FieldTextInput } from '../../components/composer-input/FieldTextInput'
import { ListGroup, ListRow, SectionHeader } from '../../components/list/ListGroup'
import { MobileSegmentedControl } from '../../components/controls/MobileSegmentedControl'
import { SheetHeader } from '../../components/nav-bar/SheetHeader'
import { PickerModal, type PickerOption } from '../../components/sheets/PickerModal'
import { SheetPrimaryButton } from '../../components/sheets/SheetPrimaryButton'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { TEXT_INPUT_FONT_SIZE } from '../../platform/text-input/text-input-font-size'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { colors, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { MobileTaskStartBaseRefPicker } from './MobileTaskStartBaseRefPicker'
import {
  pickRoleField,
  readRoleChoice,
  roleFieldOptions,
  roleLabel,
  roleSummary,
  type RoleField
} from './task-start-role-choices'
import type { TaskStartAsStatus, TaskStartChoices } from './use-task-board-start'
import { useTaskStartOptions } from './use-task-start-options'

// Over the sheet it opens from.
const PICKER_Z_INDEX = 1100

/** This start's choices on top of the repository's configuration; none of them is saved. */
type Edits = { mode?: TaskStartWorkspaceMode; baseRef?: string; roles: TaskStartRoles }
type Picker = { kind: 'repo' } | { kind: 'base' } | { kind: RoleField; role: TaskStartRole } | null

type Props = {
  card: TaskBoardWireCard
  client: RpcClient | null
  connected: boolean
  /** The host could not resolve the card's repository: the user must pick one. */
  repoRequired: boolean
  status: TaskStartAsStatus
  onSubmit: (choices: TaskStartChoices) => void
  onClose: () => void
}

/** "Start as…": repository, mode, base branch and the six roles' agents, for one start of the card. */
export function MobileTaskStartSheet(props: Props) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const { card, status } = props
  // The user's repository; until they pick one, the host resolves it from the card.
  const [chosenRepoId, setChosenRepoId] = useState<string | undefined>(undefined)
  const [edits, setEdits] = useState<Edits>({ roles: {} })
  // Kept when the repository changes: it is about the task, not the repository.
  const [userPrompt, setUserPrompt] = useState('')
  const [picker, setPicker] = useState<Picker>(null)
  const options = useTaskStartOptions(props.client, props.connected, card.ref, chosenRepoId)
  const data = options.data
  const repoId = chosenRepoId ?? data?.repoId ?? null
  const repo = data?.repos.find((entry) => entry.id === repoId)
  const isFolder = repo?.kind === 'folder'
  const mode = edits.mode ?? data?.workspaceMode ?? 'worktree'
  const canSubmit =
    Boolean(repoId) && Boolean(data) && !options.loading && !status.pending && props.connected
  const catalog = data?.catalog ?? []

  const submit = (): void => {
    if (!repoId) {
      return
    }
    props.onSubmit({
      repoId,
      ...(edits.mode ? { workspaceMode: edits.mode } : {}),
      ...(edits.baseRef ? { baseRef: edits.baseRef } : {}),
      ...(Object.keys(edits.roles).length > 0 ? { roles: edits.roles } : {}),
      ...(userPrompt.trim() ? { userPrompt: userPrompt.trim() } : {})
    })
  }

  const pickerProps = ((): { title: string; options: PickerOption[]; selected: string } | null => {
    if (!picker || !data || picker.kind === 'base') {
      return null
    }
    if (picker.kind === 'repo') {
      return {
        title: t('tasks.board.start.repository', 'Repository'),
        options: data.repos.map((entry) => ({ value: entry.id, label: entry.label })),
        selected: repoId ?? ''
      }
    }
    return {
      title: roleLabel(picker.role, t),
      ...roleFieldOptions(
        picker.kind,
        catalog,
        edits.roles[picker.role],
        data.labels?.[picker.role],
        t
      )
    }
  })()

  return (
    <>
      <SheetHeader
        title={t('tasks.board.start.sheetTitle', 'Start {{id}} as…', { id: card.displayId })}
        subtitle={card.title}
        onClose={props.onClose}
      />
      <Text style={styles.note}>
        {t(
          'tasks.board.start.sheetNote',
          'Choices here apply to this start only; saved settings stay as they are.'
        )}
      </Text>
      <ListGroup>
        <ListRow
          title={t('tasks.board.start.repository', 'Repository')}
          value={repo?.label ?? t('tasks.board.start.chooseRepository', 'Choose a repository')}
          destructive={props.repoRequired && !repoId}
          navigates
          disabled={!data}
          onPress={() => setPicker({ kind: 'repo' })}
        />
      </ListGroup>
      {props.repoRequired && !repoId ? (
        <Text style={styles.problem}>
          {t(
            'tasks.board.start.repositoryRequired',
            'Orca could not tell which repository this issue belongs to. Choose one.'
          )}
        </Text>
      ) : null}
      {repoId && data && !isFolder ? (
        <>
          <SectionHeader title={t('tasks.board.start.mode', 'Workspace mode')} />
          <MobileSegmentedControl
            segments={[
              { value: 'worktree', label: t('tasks.board.start.modeWorktree', 'New worktree') },
              { value: 'primary', label: t('tasks.board.start.modePrimary', 'Primary branch') }
            ]}
            selected={mode}
            onSelect={(value) => setEdits({ ...edits, mode: value })}
            fill
            onSheet
          />
        </>
      ) : null}
      {repoId && data && !isFolder ? (
        <ListGroup style={styles.base}>
          <ListRow
            title={t('tasks.board.start.baseBranch', 'Base branch')}
            value={
              edits.baseRef
                ? branchRefLabel(edits.baseRef)
                : (data.baseRef ??
                  t('tasks.board.start.baseBranchDefault', 'Default for this repository'))
            }
            navigates
            onPress={() => setPicker({ kind: 'base' })}
          />
        </ListGroup>
      ) : null}
      <SectionHeader title={t('tasks.board.start.agents', 'Agents')} />
      {options.error ? (
        <Text style={styles.problem}>{options.error}</Text>
      ) : !data ? (
        <Text style={styles.note}>{t('tasks.board.start.loadingAgents', 'Loading agents…')}</Text>
      ) : (
        <ListGroup>
          {TASK_START_ROLES.flatMap((role) => {
            const value = edits.roles[role]
            const { entry, model } = readRoleChoice(catalog, value)
            const label = roleLabel(role, t)
            const rows = [
              <ListRow
                key={role}
                title={label}
                value={roleSummary(catalog, value, data.labels?.[role], t)}
                destructive={data.invalidRoles.includes(role) && !value}
                navigates
                onPress={() => setPicker({ kind: 'agent', role })}
              />
            ]
            if (entry && entry.models.length > 0) {
              rows.push(
                <ListRow
                  key={`${role}:model`}
                  title={t('tasks.board.start.roleModel', '{{role}} · model', { role: label })}
                  value={model?.label ?? value?.model ?? t('tasks.board.start.default', 'Default')}
                  navigates
                  onPress={() => setPicker({ kind: 'model', role })}
                />
              )
            }
            if (model && model.efforts.length > 0) {
              rows.push(
                <ListRow
                  key={`${role}:effort`}
                  title={t('tasks.board.start.roleEffort', '{{role}} · effort', { role: label })}
                  value={
                    model.efforts.find((e) => e.id === value?.effort)?.label ??
                    t('tasks.board.start.default', 'Default')
                  }
                  navigates
                  onPress={() => setPicker({ kind: 'effort', role })}
                />
              )
            }
            return rows
          })}
        </ListGroup>
      )}
      <SectionHeader title={t('tasks.board.start.userPrompt', 'Additional instructions')} />
      <FieldTextInput
        value={userPrompt}
        onChangeText={setUserPrompt}
        editable={!status.pending}
        multiline
        maxLength={8000}
        placeholder={t(
          'tasks.board.start.userPromptPlaceholder',
          'Optional. Sent to the orchestrator with the card and the flow.'
        )}
        style={styles.userPrompt}
        accessibilityLabel={t('tasks.board.start.userPrompt', 'Additional instructions')}
      />
      <View style={styles.footer}>
        {status.error ? <Text style={styles.problem}>{status.error}</Text> : null}
        <SheetPrimaryButton
          label={t('tasks.board.start.submit', 'Start')}
          onPress={submit}
          disabled={!canSubmit}
          busy={status.pending}
        />
      </View>
      <PickerModal
        visible={pickerProps !== null}
        title={pickerProps?.title ?? ''}
        options={pickerProps?.options ?? []}
        selected={pickerProps?.selected ?? ''}
        zIndex={PICKER_Z_INDEX}
        onSelect={(value) => {
          if (picker?.kind === 'repo') {
            // Another repository has its own mode, base branch and roles.
            setChosenRepoId(value)
            setEdits({ roles: {} })
          } else if (picker && picker.kind !== 'base') {
            setEdits({
              ...edits,
              roles: pickRoleField(edits.roles, picker.role, picker.kind, value, catalog)
            })
          }
        }}
        onClose={() => setPicker(null)}
      />
      {repoId && data ? (
        <MobileTaskStartBaseRefPicker
          key={repoId}
          visible={picker?.kind === 'base'}
          client={props.client}
          repoId={repoId}
          defaultRef={data.baseRef}
          selected={edits.baseRef}
          zIndex={PICKER_Z_INDEX}
          onSelect={(baseRef) => setEdits({ ...edits, baseRef })}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  )
}

const styles = themedStyleSheet(() => ({
  note: {
    paddingBottom: spacing.md,
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  problem: {
    paddingTop: spacing.sm,
    fontSize: typography.metaSize,
    color: colors.statusRed
  },
  base: {
    marginTop: spacing.md
  },
  userPrompt: {
    fontSize: TEXT_INPUT_FONT_SIZE,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 96,
    maxHeight: 240,
    textAlignVertical: 'top'
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  }
}))

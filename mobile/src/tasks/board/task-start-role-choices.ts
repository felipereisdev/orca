import type { TaskStartAgentCatalogEntry } from '../../../../src/shared/task-board/task-board-wire-types'
import type {
  TaskStartAgentChoice,
  TaskStartRole,
  TaskStartRoles
} from '../../../../src/shared/task-board/task-start-settings'
import type { PickerOption } from '../../components/PickerModal'
import type { Translate } from '../../i18n/mobile-i18n'

// The desktop role picker's rules (TaskStartRolePicker) for the phone's one-list pickers.

export const INHERIT = '__inherit__'
export const DEFAULT = '__default__'

export type RoleField = 'agent' | 'model' | 'effort'

function entryKey(agent: string, accountId: string | undefined): string {
  return `${agent}\u0000${accountId ?? ''}`
}

export function roleLabel(role: TaskStartRole, t: Translate): string {
  switch (role) {
    case 'orchestrator':
      return t('tasks.board.start.role.orchestrator', 'Orchestrator')
    case 'planner':
      return t('tasks.board.start.role.planner', 'Planner')
    case 'planReviewer':
      return t('tasks.board.start.role.planReviewer', 'Plan reviewer')
    case 'implementer':
      return t('tasks.board.start.role.implementer', 'Implementer')
    case 'reviewer':
      return t('tasks.board.start.role.reviewer', 'Reviewer')
    case 'qa':
      return t('tasks.board.start.role.qa', 'QA')
  }
}

/** The role's choice resolved against the catalog: what is unknown to this host is marked. */
export function readRoleChoice(
  catalog: TaskStartAgentCatalogEntry[],
  value?: TaskStartAgentChoice
) {
  const entry = value
    ? catalog.find((e) => e.agent === value.agent && e.accountId === value.accountId)
    : undefined
  const model = entry?.models.find((m) => m.id === value?.model)
  const effort = model?.efforts.find((e) => e.id === value?.effort)
  return { entry, model, effort, invalid: value !== undefined && entry === undefined }
}

function unavailable(name: string, t: Translate): string {
  return t('tasks.board.start.unavailable', 'Unavailable · {{name}}', { name })
}

/** The role row's value: the picked agent, model and effort, or what it inherits. */
export function roleSummary(
  catalog: TaskStartAgentCatalogEntry[],
  value: TaskStartAgentChoice | undefined,
  inherited: string | undefined,
  t: Translate
): string {
  if (!value) {
    return inherited === undefined
      ? t('tasks.board.start.chooseAgent', 'Choose an agent')
      : t('tasks.board.start.inherit', 'Inherit ({{value}})', { value: inherited })
  }
  const { entry, model, effort } = readRoleChoice(catalog, value)
  const name =
    entry?.label ?? (value.accountId ? `${value.agent} (${value.accountId})` : value.agent)
  return [
    entry ? name : unavailable(name, t),
    model?.label ?? value.model,
    effort?.label ?? value.effort
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The options of one field's picker and the one now picked. */
export function roleFieldOptions(
  field: RoleField,
  catalog: TaskStartAgentCatalogEntry[],
  value: TaskStartAgentChoice | undefined,
  inherited: string | undefined,
  t: Translate
): { options: PickerOption[]; selected: string } {
  const { entry, model } = readRoleChoice(catalog, value)
  const defaultOption = { value: DEFAULT, label: t('tasks.board.start.default', 'Default') }
  if (field === 'agent') {
    const options: PickerOption[] = catalog.map((e) => ({
      value: entryKey(e.agent, e.accountId),
      label: e.label,
      ...(e.needsSignIn ? { subtitle: t('tasks.board.start.needsSignIn', 'needs sign-in') } : {})
    }))
    if (inherited !== undefined) {
      options.unshift({
        value: INHERIT,
        label: t('tasks.board.start.inherit', 'Inherit ({{value}})', { value: inherited })
      })
    }
    return { options, selected: value ? entryKey(value.agent, value.accountId) : INHERIT }
  }
  if (field === 'model') {
    const models = (entry?.models ?? []).map((m) => ({ value: m.id, label: m.label }))
    return { options: [defaultOption, ...models], selected: value?.model ?? DEFAULT }
  }
  const efforts = (model?.efforts ?? []).map((e) => ({ value: e.id, label: e.label }))
  return { options: [defaultOption, ...efforts], selected: value?.effort ?? DEFAULT }
}

/** The roles after one field's pick; a new agent drops the model and effort it cannot keep. */
export function pickRoleField(
  roles: TaskStartRoles,
  role: TaskStartRole,
  field: RoleField,
  picked: string,
  catalog: TaskStartAgentCatalogEntry[]
): TaskStartRoles {
  const { [role]: value, ...rest } = roles
  if (field === 'agent') {
    const next = catalog.find((e) => entryKey(e.agent, e.accountId) === picked)
    if (picked === INHERIT || !next) {
      return rest
    }
    return {
      ...rest,
      [role]: { agent: next.agent, ...(next.accountId ? { accountId: next.accountId } : {}) }
    }
  }
  if (!value) {
    return roles
  }
  if (field === 'model') {
    const { model: _model, effort: _effort, ...agent } = value
    return { ...rest, [role]: picked === DEFAULT ? agent : { ...agent, model: picked } }
  }
  const { effort: _effort, ...withModel } = value
  return { ...rest, [role]: picked === DEFAULT ? withModel : { ...withModel, effort: picked } }
}

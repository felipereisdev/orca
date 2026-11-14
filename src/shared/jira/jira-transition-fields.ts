import type { TaskBoardChoice, TaskBoardMoveFields } from '../task-board/task-board-wire-types'
import type {
  JiraCreateField,
  JiraCreateFieldAllowedValue,
  JiraIssueUpdate,
  JiraTransition
} from './jira-types'

export type JiraTransitionRequirement =
  | { kind: 'none' }
  | {
      kind: 'form'
      resolution: JiraCreateField | null
      commentRequired: boolean
    }
  | {
      kind: 'unsupported'
      fields: JiraCreateField[]
    }

function isResolutionField(field: JiraCreateField): boolean {
  return field.key === 'resolution' && !field.schema?.custom
}

function isCommentField(field: JiraCreateField): boolean {
  return field.key === 'comment' && !field.schema?.custom
}

export function requiredTransitionFields(transition: JiraTransition): JiraCreateField[] {
  return (transition.fields ?? []).filter((field) => field.required)
}

export function classifyTransitionRequirements(
  transition: JiraTransition
): JiraTransitionRequirement {
  const required = requiredTransitionFields(transition)
  if (required.length === 0) {
    return { kind: 'none' }
  }

  let resolution: JiraCreateField | null = null
  let commentRequired = false
  const unsupported: JiraCreateField[] = []

  for (const field of required) {
    if (required.filter((other) => other.key === field.key).length > 1) {
      unsupported.push(field)
      continue
    }
    if (
      isResolutionField(field) &&
      field.allowedValues?.some((value) => transitionAllowedValueKey(value))
    ) {
      resolution = field
      continue
    }
    if (isCommentField(field)) {
      commentRequired = true
      continue
    }
    unsupported.push(field)
  }

  if (unsupported.length > 0) {
    return { kind: 'unsupported', fields: unsupported }
  }

  return { kind: 'form', resolution, commentRequired }
}

export function transitionAllowedValueLabel(value: JiraCreateFieldAllowedValue): string {
  return value.name ?? value.value ?? value.id ?? 'Option'
}

/** Stable select value / draft key — keep in sync with option `value` and draft seed. */
export function transitionAllowedValueKey(value: JiraCreateFieldAllowedValue): string {
  return value.id?.trim() || value.value?.trim() || value.name?.trim() || ''
}

export function buildResolutionFieldValue(
  field: JiraCreateField,
  selectedId: string
): Record<string, string> | null {
  const trimmed = selectedId.trim()
  if (!trimmed) {
    return null
  }
  const match = field.allowedValues?.find((value) => transitionAllowedValueKey(value) === trimmed)
  if (match?.id?.trim()) {
    return { id: match.id.trim() }
  }
  if (match?.name?.trim()) {
    return { name: match.name.trim() }
  }
  if (match?.value?.trim()) {
    return { value: match.value.trim() }
  }
  return null
}

/** The transition as a client renders it: Resolution and Comment are fillable, any other required field is not. */
export function jiraTransitionChoice(transition: JiraTransition): TaskBoardChoice {
  const requirement = classifyTransitionRequirements(transition)
  const choice = { id: transition.id, name: transition.name }
  if (requirement.kind === 'none') {
    return { ...choice, fields: null }
  }
  if (requirement.kind === 'unsupported') {
    return {
      ...choice,
      fields: 'unsupported',
      unsupportedFieldNames: requirement.fields.map((field) => field.name)
    }
  }
  const { resolution, commentRequired } = requirement
  return {
    ...choice,
    fields: {
      resolution: resolution
        ? {
            name: resolution.name,
            required: true,
            options: (resolution.allowedValues ?? []).flatMap((value) => {
              const id = transitionAllowedValueKey(value)
              return id ? [{ id, name: transitionAllowedValueLabel(value) }] : []
            })
          }
        : null,
      commentRequired
    }
  }
}

/** The update a filled choice applies; null while a required field is missing or unsupported. */
export function jiraTransitionUpdate(
  transition: JiraTransition,
  fields: TaskBoardMoveFields = {}
): JiraIssueUpdate | null {
  const requirement = classifyTransitionRequirements(transition)
  if (requirement.kind === 'unsupported') {
    return null
  }
  if (requirement.kind === 'none') {
    return { transitionId: transition.id }
  }
  const { resolution: resolutionField, commentRequired } = requirement
  const resolution = resolutionField
    ? buildResolutionFieldValue(resolutionField, fields.resolutionId ?? '')
    : null
  const comment = fields.comment?.trim() ?? ''
  if ((resolutionField && !resolution) || (commentRequired && !comment)) {
    return null
  }
  return {
    transitionId: transition.id,
    ...(resolutionField && resolution
      ? { transitionFields: { [resolutionField.key]: resolution } }
      : {}),
    // A comment goes only where the transition asks for one.
    ...(commentRequired ? { transitionComment: comment } : {})
  }
}

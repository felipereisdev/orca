import type {
  GitLabWorkItemStatus,
  GitLabWorkItemStatusLifecycle
} from '../../../shared/gitlab/gitlab-types'

/** `unsupported`: the instance has no statuses (labels are right); `failed`: it could not answer. */
export type GitLabStatusReadFailure = { kind: 'unsupported' } | { kind: 'failed'; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStatus(value: unknown): GitLabWorkItemStatus | null {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    ? { id: value.id, name: value.name }
    : null
}

function graphqlErrors(payload: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(payload.errors) ? payload.errors.filter(isRecord) : []
}

// Older, CE or Free schemas reject the status types and fields before running the query.
function isSchemaError(error: Record<string, unknown>): boolean {
  const code = isRecord(error.extensions) ? error.extensions.code : undefined
  return code === 'undefinedType' || code === 'undefinedField'
}

function failed(error: string): GitLabStatusReadFailure {
  return { kind: 'failed', error }
}

/** The work item nodes of `project.workItems`, or why there are none. */
function workItemNodes(
  payload: unknown
): { nodes: Record<string, unknown>[] } | GitLabStatusReadFailure {
  if (!isRecord(payload)) {
    return failed('GitLab returned an unreadable status reply')
  }
  const errors = graphqlErrors(payload)
  if (errors.length > 0) {
    return errors.every(isSchemaError)
      ? { kind: 'unsupported' }
      : failed(errors.map((error) => String(error.message ?? '')).join('; '))
  }
  const project = isRecord(payload.data) ? payload.data.project : undefined
  const workItems = isRecord(project) ? project.workItems : undefined
  const nodes = isRecord(workItems) ? workItems.nodes : undefined
  return Array.isArray(nodes)
    ? { nodes: nodes.filter(isRecord) }
    : failed('GitLab did not return the project’s work items')
}

/** True when every error is a field missing from the schema and named in `fields`. */
export function onlyMissingFields(payload: unknown, fields: readonly string[]): boolean {
  const errors = isRecord(payload) ? graphqlErrors(payload) : []
  return (
    errors.length > 0 &&
    errors.every(
      (error) =>
        isRecord(error.extensions) &&
        error.extensions.code === 'undefinedField' &&
        typeof error.extensions.fieldName === 'string' &&
        fields.includes(error.extensions.fieldName)
    )
  )
}

// Inline fragments answer `{}` for every other widget; only the status widget has `status`.
function statusOf(node: Record<string, unknown>): GitLabWorkItemStatus | null {
  const widgets = Array.isArray(node.widgets) ? node.widgets : []
  const widget = widgets.find((entry) => isRecord(entry) && 'status' in entry)
  return isRecord(widget) ? parseStatus(widget.status) : null
}

function iidOf(node: Record<string, unknown>): number | null {
  const iid = typeof node.iid === 'string' ? Number(node.iid) : Number.NaN
  return Number.isSafeInteger(iid) ? iid : null
}

export type GitLabWorkItemStatusesRead =
  | { kind: 'statuses'; statuses: Map<number, GitLabWorkItemStatus | null> }
  | GitLabStatusReadFailure

/** Status by iid; null for an item without the status widget. */
export function parseWorkItemStatusesResponse(payload: unknown): GitLabWorkItemStatusesRead {
  const read = workItemNodes(payload)
  if (!('nodes' in read)) {
    return read
  }
  const statuses = new Map<number, GitLabWorkItemStatus | null>()
  for (const node of read.nodes) {
    const iid = iidOf(node)
    if (iid !== null) {
      statuses.set(iid, statusOf(node))
    }
  }
  return { kind: 'statuses', statuses }
}

export type GitLabWorkItemStatusTarget = {
  /** The work item's global ID, which `workItemUpdate` takes. */
  workItemId: string
  status: GitLabWorkItemStatus | null
  lifecycle: GitLabWorkItemStatusLifecycle
}

export type GitLabWorkItemStatusTargetRead =
  | { kind: 'target'; target: GitLabWorkItemStatusTarget }
  | GitLabStatusReadFailure

/** The item's id, Status and its type's allowed statuses; `unsupported` without a status widget. */
export function parseWorkItemStatusTargetResponse(
  payload: unknown,
  iid: number
): GitLabWorkItemStatusTargetRead {
  const read = workItemNodes(payload)
  if (!('nodes' in read)) {
    return read
  }
  const node = read.nodes.find((entry) => iidOf(entry) === iid)
  if (!node || typeof node.id !== 'string') {
    return failed(`GitLab did not return work item #${iid}`)
  }
  const type = isRecord(node.workItemType) ? node.workItemType : {}
  const definitions = Array.isArray(type.widgetDefinitions) ? type.widgetDefinitions : []
  const definition = definitions.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && Array.isArray(entry.allowedStatuses)
  )
  if (!definition || !Array.isArray(definition.allowedStatuses)) {
    return { kind: 'unsupported' }
  }
  return {
    kind: 'target',
    target: {
      workItemId: node.id,
      status: statusOf(node),
      lifecycle: {
        allowedStatuses: definition.allowedStatuses
          .map(parseStatus)
          .filter((status): status is GitLabWorkItemStatus => status !== null),
        // Absent before GitLab 18.0, where the status query leaves them out.
        defaultOpenStatus: parseStatus(definition.defaultOpenStatus),
        defaultClosedStatus: parseStatus(definition.defaultClosedStatus)
      }
    }
  }
}

function errorMessages(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) =>
          typeof entry === 'string' ? entry : isRecord(entry) ? String(entry.message ?? '') : ''
        )
        .filter((message) => message.trim().length > 0)
    : []
}

/** `workItemUpdate` confirms only with no errors at either level and the item in its payload. */
export function parseWorkItemStatusUpdateResponse(
  payload: unknown
): { ok: true } | { ok: false; error: string } {
  const failure = (detail: string[]) => ({
    ok: false as const,
    error: detail.length
      ? `GitLab could not set the status: ${detail.join('; ')}`
      : 'GitLab could not confirm the status change. Refresh to check it.'
  })
  if (!isRecord(payload)) {
    return failure([])
  }
  const topErrors = errorMessages(payload.errors)
  const update = isRecord(payload.data) ? payload.data.workItemUpdate : undefined
  const updateErrors = isRecord(update) ? errorMessages(update.errors) : []
  if (topErrors.length || updateErrors.length) {
    return failure([...topErrors, ...updateErrors])
  }
  return isRecord(update) && isRecord(update.workItem) ? { ok: true } : failure([])
}

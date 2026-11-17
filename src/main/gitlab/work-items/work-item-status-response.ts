import type {
  GitLabWorkItemStatus,
  GitLabWorkItemStatusLifecycle
} from '../../../shared/gitlab/gitlab-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStatus(value: unknown): GitLabWorkItemStatus | null {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    ? { id: value.id, name: value.name }
    : null
}

/** The work item nodes of `project.workItems`; null for a GraphQL error or an unreadable project. */
function workItemNodes(payload: unknown): Record<string, unknown>[] | null {
  if (!isRecord(payload)) {
    return null
  }
  // Older or Free instances reject the status fragment with an errors array.
  if (payload.errors !== undefined && !(Array.isArray(payload.errors) && !payload.errors.length)) {
    return null
  }
  const project = isRecord(payload.data) ? payload.data.project : undefined
  const workItems = isRecord(project) ? project.workItems : undefined
  const nodes = isRecord(workItems) ? workItems.nodes : undefined
  return Array.isArray(nodes) ? nodes.filter(isRecord) : null
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

/** Status by iid (null when the item has none); null when the instance cannot answer. */
export function parseWorkItemStatusesResponse(
  payload: unknown
): Map<number, GitLabWorkItemStatus | null> | null {
  const nodes = workItemNodes(payload)
  if (!nodes) {
    return null
  }
  const statuses = new Map<number, GitLabWorkItemStatus | null>()
  for (const node of nodes) {
    const iid = iidOf(node)
    if (iid !== null) {
      statuses.set(iid, statusOf(node))
    }
  }
  return statuses
}

export type GitLabWorkItemStatusTarget = {
  /** The work item's global ID, which `workItemUpdate` takes. */
  workItemId: string
  status: GitLabWorkItemStatus | null
  lifecycle: GitLabWorkItemStatusLifecycle
}

/** The item's id, Status and its type's allowed statuses; null when it has no status widget. */
export function parseWorkItemStatusTargetResponse(
  payload: unknown,
  iid: number
): GitLabWorkItemStatusTarget | null {
  const node = workItemNodes(payload)?.find((entry) => iidOf(entry) === iid)
  if (!node || typeof node.id !== 'string') {
    return null
  }
  const type = isRecord(node.workItemType) ? node.workItemType : {}
  const definitions = Array.isArray(type.widgetDefinitions) ? type.widgetDefinitions : []
  const definition = definitions.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && Array.isArray(entry.allowedStatuses)
  )
  if (!definition || !Array.isArray(definition.allowedStatuses)) {
    return null
  }
  return {
    workItemId: node.id,
    status: statusOf(node),
    lifecycle: {
      allowedStatuses: definition.allowedStatuses
        .map(parseStatus)
        .filter((status): status is GitLabWorkItemStatus => status !== null),
      defaultOpenStatus: parseStatus(definition.defaultOpenStatus),
      defaultClosedStatus: parseStatus(definition.defaultClosedStatus)
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

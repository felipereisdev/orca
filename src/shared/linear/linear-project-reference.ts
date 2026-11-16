import type { Repo } from '../repository/repo-types'

/** A repo's Linear project: its cards start in that repo. */
export type LinearProjectReference = { id: string; name: string; workspaceId: string | null }

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeLinearProjectReference(
  value: unknown
): LinearProjectReference | null | undefined {
  if (value === null) {
    return null
  }
  if (!value || typeof value !== 'object' || !('id' in value) || !('name' in value)) {
    return undefined
  }
  const id = trimmedString(value.id)
  const name = trimmedString(value.name)
  if (!id || !name) {
    return undefined
  }
  const workspaceId = 'workspaceId' in value ? trimmedString(value.workspaceId) : null
  return { id, name, workspaceId }
}

/** Repos whose default Linear project is the issue's; workspaces must agree when both are known. */
export function findLinearProjectRepoCandidates(
  repos: readonly Repo[],
  project: { id: string; workspaceId: string | null }
): Repo[] {
  return repos.filter((repo) => {
    const reference = repo.defaultLinearProject
    return (
      reference?.id === project.id &&
      (!reference.workspaceId ||
        !project.workspaceId ||
        reference.workspaceId === project.workspaceId)
    )
  })
}

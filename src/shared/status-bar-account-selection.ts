export type StatusBarAccountSelection = Record<string, string[]>

export function normalizeStatusBarAccountSelection(value: unknown): StatusBarAccountSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([scope, ids]): [string, string[]][] =>
      Array.isArray(ids)
        ? [
            [
              scope,
              [
                ...new Set(
                  ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
                )
              ]
            ]
          ]
        : []
    )
  )
}

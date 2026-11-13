import type { TaskProvider } from '../work-items/task-providers'

export type TaskBoardRule = { match: string; statusId: string }
export type TaskBoardProviderSettings = {
  rules: TaskBoardRule[]
  dropTargets: Record<string, string>
}
export type TaskBoardSettings = {
  doneStatusId: string
  providers: Record<TaskProvider, TaskBoardProviderSettings>
}
export type TaskBoardSettingsField = { taskBoard?: TaskBoardSettings }

export const TASK_BOARD_DONE_WINDOW_DAYS = 14

const DEFAULT_DONE_STATUS_ID = 'completed'
const MAX_RULES_PER_PROVIDER = 50
const MAX_MATCH_LENGTH = 120
const MAX_ID_LENGTH = 64

export function getDefaultTaskBoardSettings(): TaskBoardSettings {
  return normalizeTaskBoardSettings(undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeProvider(value: unknown): TaskBoardProviderSettings {
  const raw = isRecord(value) ? value : {}
  const rules: TaskBoardRule[] = []
  if (Array.isArray(raw.rules)) {
    for (const entry of raw.rules) {
      if (rules.length >= MAX_RULES_PER_PROVIDER) {
        break
      }
      if (!isRecord(entry)) {
        continue
      }
      const match = cleanString(entry.match, MAX_MATCH_LENGTH)
      const statusId = cleanString(entry.statusId, MAX_ID_LENGTH)
      if (match && statusId) {
        rules.push({ match, statusId })
      }
    }
  }
  const dropTargets: Record<string, string> = {}
  if (isRecord(raw.dropTargets)) {
    for (const [key, target] of Object.entries(raw.dropTargets)) {
      const columnId = cleanString(key, MAX_ID_LENGTH)
      const name = cleanString(target, MAX_MATCH_LENGTH)
      if (columnId && name) {
        dropTargets[columnId] = name
      }
    }
  }
  return { rules, dropTargets }
}

export function normalizeTaskBoardSettings(value: unknown): TaskBoardSettings {
  const raw = isRecord(value) ? value : {}
  const rawProviders = isRecord(raw.providers) ? raw.providers : {}
  const providers: Record<TaskProvider, TaskBoardProviderSettings> = {
    github: normalizeProvider(rawProviders.github),
    gitlab: normalizeProvider(rawProviders.gitlab),
    linear: normalizeProvider(rawProviders.linear),
    jira: normalizeProvider(rawProviders.jira)
  }
  return {
    doneStatusId: cleanString(raw.doneStatusId, MAX_ID_LENGTH) || DEFAULT_DONE_STATUS_ID,
    providers
  }
}

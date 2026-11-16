import { normalizeStatusBarAccountSelection } from './status-bar-account-selection'
import { normalizeStatusBarUsageFormat } from './status-bar-usage-format'
import { normalizeStatusBarUsageMode } from './status-bar-usage-mode'

type StatusBarPreferenceInput = {
  statusBarClaudeAccountIdsByScope?: unknown
  statusBarUsageFormat?: unknown
  statusBarUsageMode?: unknown
}

export function normalizeStatusBarPreferences(
  value: StatusBarPreferenceInput,
  fallback: StatusBarPreferenceInput = {}
) {
  return {
    statusBarClaudeAccountIdsByScope: normalizeStatusBarAccountSelection(
      value.statusBarClaudeAccountIdsByScope ?? fallback.statusBarClaudeAccountIdsByScope
    ),
    statusBarUsageFormat: normalizeStatusBarUsageFormat(
      value.statusBarUsageFormat ?? fallback.statusBarUsageFormat
    ),
    statusBarUsageMode: normalizeStatusBarUsageMode(
      value.statusBarUsageMode ?? fallback.statusBarUsageMode
    )
  }
}

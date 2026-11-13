import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'

export const WORKTREE_SET_COMMAND_SPEC: CommandSpec = {
  path: ['worktree', 'set'],
  summary: 'Update Orca metadata for a worktree',
  usage:
    'orca worktree set --worktree <selector> [--display-name <name>] [--issue <number|null>] [--pr <number|null>] [--jira-issue <KEY|URL>] [--jira-site <id>] [--linear-issue <identifier-or-url|null>] [--gitlab-issue <number-or-url|null>] [--gitlab-mr <number-or-url|null>] [--comment <text>] [--workspace-status <id>] [--unread|--read] [--parent-worktree <selector> [--parent-environment <environment>]|--no-parent] [--json]',
  allowedFlags: [
    ...GLOBAL_FLAGS,
    'worktree',
    'display-name',
    'issue',
    'pr',
    'linear-issue',
    'jira-issue',
    'jira-site',
    'gitlab-issue',
    'gitlab-mr',
    'comment',
    'workspace-status',
    'unread',
    'read',
    'parent-worktree',
    'parent-environment',
    'no-parent'
  ],
  notes: [
    'Do not combine --jira-issue with --issue, --pr, --linear-issue, --gitlab-issue or --gitlab-mr; use separate commands or reference add.',
    '--jira-issue verifies a Jira key or browse URL and stores a native task attachment; use --jira-site to select one connected site.',
    'Workspace status ids match the board columns (defaults: todo, in-progress, in-review, completed); custom statuses use their configured id.',
    'Pass --comment "" (or --comment=) to clear the comment.',
    'Pass --linear-issue null to clear the Linear issue link.',
    "--parent-worktree is looked up in the worktree's own environment; add --parent-environment <local|environment-id> for a parent in another environment. No other environment is searched.",
    'Pass --pr null, --gitlab-issue null, or --gitlab-mr null to clear only the matching link.',
    'Each link flag updates its own field and leaves unrelated links unchanged. GitLab URLs must match the stored source project or remote; they cannot select a foreign project.',
    'On a folder workspace (folder:<id>, or a path:/name: selector that matches one), --display-name, --comment, --workspace-status, --unread/--read and --jira-issue/--jira-site apply. Parent and legacy link flags are refused; use orca reference add for other references.'
  ],
  examples: [
    'orca worktree set --worktree active --linear-issue STA-335 --json',
    'orca worktree set --worktree active --linear-issue null --json',
    'orca worktree set --worktree active --comment "" --json',
    'orca worktree set --worktree active --workspace-status in-review --unread --json'
  ]
}

import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'

export const DATABASE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['db', 'list'],
    summary: 'List database environments associated with a project',
    usage: 'orca db list [--project <id>|--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'worktree']
  },
  {
    path: ['db', 'describe'],
    summary: 'Inspect accessible schemas, tables, columns and keys',
    usage:
      'orca db describe --connection <alias|id> [--schema <name>] [--table <name>] [--project <id>|--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'connection', 'schema', 'table', 'project', 'worktree']
  },
  {
    path: ['db', 'query'],
    summary: 'Execute SQL using the access mode of an explicitly selected environment',
    usage:
      'orca db query --connection <alias|id> --sql-file <path|-> [--parameters-file <path|->] [--project <id>|--worktree <selector>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'connection',
      'sql-file',
      'parameters-file',
      'project',
      'worktree'
    ]
  },
  {
    path: ['db', 'cancel'],
    summary: 'Cancel an existing database execution by query ID',
    usage: 'orca db cancel <query-id> [--project <id>|--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'query-id', 'project', 'worktree'],
    positionalArgs: ['query-id']
  },
  {
    path: ['db', 'history'],
    summary: 'List retained database execution metadata for a project',
    usage: 'orca db history [--project <id>|--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'worktree']
  }
]

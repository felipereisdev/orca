import type {
  DatabaseQueryHandle,
  DatabaseQuerySnapshot,
  ExpiredDatabaseResult
} from '../../shared/database/database-query-contracts'
import type { DatabaseConnectionSummary } from '../../shared/database/database-contracts'
import { DatabaseParameters } from '../../shared/rpc-contract/database-params'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import {
  buildCurrentWorktreeSelector,
  normalizeWorktreeSelector
} from '../workspace-selection/workspace-selector'
import { RuntimeClientError } from '../runtime/types'

function scope({ flags, client, cwd }: HandlerContext) {
  const project = getOptionalStringFlag(flags, 'project')
  const worktree = getOptionalStringFlag(flags, 'worktree')
  if (project && worktree) {
    throw new RuntimeClientError('invalid_argument', 'Select one project or workspace')
  }
  if (project) {
    return { project }
  }
  if (client.isRemote && (!worktree || worktree === 'current' || worktree === 'active')) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote database commands require an explicit project or workspace'
    )
  }
  return {
    worktree: worktree
      ? normalizeWorktreeSelector(worktree, cwd)
      : buildCurrentWorktreeSelector(cwd)
  }
}

const query: CommandHandler = async (context) => {
  const { flags, client, cwd, json } = context
  const connection = getRequiredStringFlag(flags, 'connection')
  const target = scope(context)
  if (flags.get('sql-file') === '-' && flags.get('parameters-file') === '-') {
    throw new RuntimeClientError(
      'invalid_argument',
      'SQL and parameter files cannot both consume stdin'
    )
  }
  const sql = await readTextOrFileFlag(flags, cwd, 'sql', true, 65536)
  const parameterText = await readTextOrFileFlag(flags, cwd, 'parameters', false, 262144)
  const parameters = DatabaseParameters.parse(
    parameterText === undefined ? [] : JSON.parse(parameterText)
  )
  const started = await client.call<DatabaseQueryHandle>('database.startQuery', {
    ...target,
    connection,
    sql,
    parameters
  })
  const queryId = started.result.queryId
  const cancel = () => {
    void client.call('database.cancelQuery', { ...target, queryId }).catch(() => {})
  }
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    cancel()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    let result: DatabaseQuerySnapshot | ExpiredDatabaseResult
    do {
      result = (
        await client.call<DatabaseQuerySnapshot | ExpiredDatabaseResult>(
          'database.waitQuery',
          { ...target, queryId },
          { timeoutMs: 30_000 }
        )
      ).result
    } while (!interrupted && (result.status === 'queued' || result.status === 'running'))
    if (result.status !== 'completed') {
      throw new RuntimeClientError(
        'database_query_failed',
        `Database query ${queryId} ${result.status}; inspect its retained history before an explicit rerun`
      )
    }
    printResult({ ...started, result }, json, (value) => JSON.stringify(value))
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'database_query_failed') {
      throw error
    }
    throw new RuntimeClientError(
      'database_query_observation_failed',
      `Could not observe database query ${queryId}; inspect its history before an explicit rerun`
    )
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

export const DATABASE_HANDLERS: Record<string, CommandHandler> = {
  'db query': query,
  'db list': async (context) => {
    const response = await context.client.call<DatabaseConnectionSummary[]>(
      'database.list',
      scope(context)
    )
    printResult(response, context.json, (connections) =>
      connections
        .map(
          (item) => `@${item.alias}\t${item.engine}\t${item.environment}\t${item.executionHostId}`
        )
        .join('\n')
    )
  },
  'db describe': async (context) => {
    const response = await context.client.call('database.describe', {
      ...scope(context),
      connection: getRequiredStringFlag(context.flags, 'connection'),
      schema: getOptionalStringFlag(context.flags, 'schema'),
      table: getOptionalStringFlag(context.flags, 'table')
    })
    printResult(response, context.json, (value) => JSON.stringify(value))
  },
  'db cancel': async (context) => {
    const response = await context.client.call('database.cancelQuery', {
      ...scope(context),
      queryId: getRequiredStringFlag(context.flags, 'query-id')
    })
    printResult(response, context.json, () => 'Database cancellation completed')
  },
  'db history': async (context) => {
    const response = await context.client.call('database.queryHistory', scope(context))
    printResult(response, context.json, (value) => JSON.stringify(value))
  }
}

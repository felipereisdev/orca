import { beforeEach, describe, expect, it, vi } from 'vitest'

const glabExecFileAsync = vi.hoisted(() => vi.fn())
vi.mock('../../git/command-runner/hosted-cli/glab-exec-file', () => ({ glabExecFileAsync }))

import { getWorkItemStatuses, getWorkItemStatusTarget } from './work-item-status'

const projectRef = { host: 'git.example.com', path: 'acme/app' }
const toDo = { id: 'gid://status/30', name: 'To do' }

/** glab exits 1 on a GraphQL errors array, with the reply on stdout. */
function glabGraphqlError(field: string) {
  return Object.assign(new Error('glab: GraphQL error'), {
    code: 1,
    stdout: JSON.stringify({
      errors: [
        {
          message: `Field '${field}' doesn't exist on type 'WorkItemWidgetDefinitionStatus'`,
          extensions: { code: 'undefinedField', fieldName: field }
        }
      ]
    })
  })
}

beforeEach(() => {
  glabExecFileAsync.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('getWorkItemStatuses', () => {
  it('reports a failure, without throwing, when glab cannot answer', async () => {
    glabExecFileAsync.mockRejectedValue(new Error('timed out'))

    await expect(getWorkItemStatuses('/src/app', projectRef, [7])).resolves.toMatchObject({
      kind: 'failed'
    })
  })
})

describe('getWorkItemStatusTarget', () => {
  it('retries without the lifecycle defaults on a GitLab older than 18.0', async () => {
    glabExecFileAsync.mockRejectedValueOnce(glabGraphqlError('defaultOpenStatus'))
    glabExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({
        data: {
          project: {
            workItems: {
              nodes: [
                {
                  id: 'gid://gitlab/WorkItem/1',
                  iid: '7',
                  widgets: [{ status: toDo }],
                  workItemType: { widgetDefinitions: [{ allowedStatuses: [toDo] }] }
                }
              ]
            }
          }
        }
      })
    })

    expect(await getWorkItemStatusTarget('/src/app', projectRef, 7)).toEqual({
      kind: 'target',
      target: {
        workItemId: 'gid://gitlab/WorkItem/1',
        status: toDo,
        lifecycle: { allowedStatuses: [toDo], defaultOpenStatus: null, defaultClosedStatus: null }
      }
    })
  })
})

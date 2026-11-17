import { describe, expect, it } from 'vitest'
import {
  parseWorkItemStatusesResponse,
  parseWorkItemStatusTargetResponse,
  parseWorkItemStatusUpdateResponse
} from './work-item-status-response'

const inReview = { id: 'gid://gitlab/WorkItems::Statuses::Custom::Status/39', name: 'In review' }
const toDo = { id: 'gid://gitlab/WorkItems::Statuses::Custom::Status/30', name: 'To do' }
const done = { id: 'gid://gitlab/WorkItems::Statuses::Custom::Status/27', name: 'Done' }

function project(nodes: unknown[]) {
  return { data: { project: { workItems: { nodes } } } }
}

describe('parseWorkItemStatusesResponse', () => {
  it('reads each item’s Status by iid, and null where the status widget is absent', () => {
    expect(
      parseWorkItemStatusesResponse(
        project([
          { iid: '7', widgets: [{}, { status: inReview }, {}] },
          { iid: '8', widgets: [{}, {}] }
        ])
      )
    ).toEqual({
      kind: 'statuses',
      statuses: new Map([
        [7, inReview],
        [8, null]
      ])
    })
  })

  it('reads a schema without the status types as unsupported', () => {
    expect(
      parseWorkItemStatusesResponse({
        errors: [
          {
            message: 'No such type WorkItemWidgetStatus, so it can’t be a fragment condition',
            extensions: { code: 'undefinedType', typeName: 'WorkItemWidgetStatus' }
          }
        ]
      })
    ).toEqual({ kind: 'unsupported' })
  })

  it('reads any other errors array as a failure', () => {
    expect(
      parseWorkItemStatusesResponse({ errors: [{ message: 'Internal server error' }] })
    ).toEqual({ kind: 'failed', error: expect.stringContaining('Internal server error') })
  })

  it('reads an unreadable project as a failure', () => {
    expect(parseWorkItemStatusesResponse({ data: { project: null } })).toMatchObject({
      kind: 'failed'
    })
  })
})

describe('parseWorkItemStatusTargetResponse', () => {
  it('reads the item’s global id, Status and its type’s allowed statuses', () => {
    const payload = project([
      {
        id: 'gid://gitlab/WorkItem/385444',
        iid: '7',
        widgets: [{ status: toDo }],
        workItemType: {
          widgetDefinitions: [
            {},
            {
              allowedStatuses: [toDo, inReview, done],
              defaultOpenStatus: toDo,
              defaultClosedStatus: done
            }
          ]
        }
      }
    ])
    expect(parseWorkItemStatusTargetResponse(payload, 7)).toEqual({
      kind: 'target',
      target: {
        workItemId: 'gid://gitlab/WorkItem/385444',
        status: toDo,
        lifecycle: {
          allowedStatuses: [toDo, inReview, done],
          defaultOpenStatus: toDo,
          defaultClosedStatus: done
        }
      }
    })
  })

  it('reads a type without a status widget definition as unsupported', () => {
    const payload = project([
      {
        id: 'gid://gitlab/WorkItem/1',
        iid: '7',
        widgets: [{}],
        workItemType: { widgetDefinitions: [{}] }
      }
    ])
    expect(parseWorkItemStatusTargetResponse(payload, 7)).toEqual({ kind: 'unsupported' })
  })
})

describe('parseWorkItemStatusUpdateResponse', () => {
  it('confirms an update that returns the item without errors', () => {
    expect(
      parseWorkItemStatusUpdateResponse({
        data: { workItemUpdate: { workItem: { id: 'gid://gitlab/WorkItem/1' }, errors: [] } }
      })
    ).toEqual({ ok: true })
  })

  it('reports the mutation’s own errors', () => {
    expect(
      parseWorkItemStatusUpdateResponse({
        data: { workItemUpdate: { workItem: null, errors: ['Status is not allowed'] } }
      })
    ).toEqual({ ok: false, error: expect.stringContaining('Status is not allowed') })
  })

  it('reports top-level GraphQL errors', () => {
    expect(
      parseWorkItemStatusUpdateResponse({
        errors: [{ message: "Field 'statusWidget' doesn't exist" }]
      })
    ).toEqual({ ok: false, error: expect.stringContaining("Field 'statusWidget' doesn't exist") })
  })
})

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
    const statuses = parseWorkItemStatusesResponse(
      project([
        { iid: '7', widgets: [{}, { status: inReview }, {}] },
        { iid: '8', widgets: [{}, {}] }
      ])
    )
    expect(statuses).toEqual(
      new Map([
        [7, inReview],
        [8, null]
      ])
    )
  })

  it('answers null for a GraphQL errors array, so cards keep their labels', () => {
    expect(
      parseWorkItemStatusesResponse({
        errors: [{ message: 'No such type WorkItemWidgetStatus, so it can’t be a fragment' }]
      })
    ).toBeNull()
  })

  it('answers null when the project is not readable', () => {
    expect(parseWorkItemStatusesResponse({ data: { project: null } })).toBeNull()
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
      workItemId: 'gid://gitlab/WorkItem/385444',
      status: toDo,
      lifecycle: {
        allowedStatuses: [toDo, inReview, done],
        defaultOpenStatus: toDo,
        defaultClosedStatus: done
      }
    })
  })

  it('answers null when the type has no status widget definition', () => {
    const payload = project([
      {
        id: 'gid://gitlab/WorkItem/1',
        iid: '7',
        widgets: [{}],
        workItemType: { widgetDefinitions: [{}] }
      }
    ])
    expect(parseWorkItemStatusTargetResponse(payload, 7)).toBeNull()
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

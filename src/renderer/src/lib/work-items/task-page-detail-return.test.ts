import { describe, expect, it } from 'vitest'
import type { JiraIssue } from '../../../../shared/jira/jira-types'
import { closeTaskPageDetail, taskDetailReturnFields } from './task-page-detail-return'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: closing only clears the field; the issue's shape is never read.
const issue = { key: 'APP-1' } as unknown as JiraIssue

describe('task page detail return', () => {
  it('returns a detail opened from My board to My board when it closes', () => {
    const opened = {
      taskSource: 'jira' as const,
      openJiraIssue: issue,
      ...taskDetailReturnFields('orca')
    }
    const closed = closeTaskPageDetail(opened)
    expect(closed.taskSource).toBe('orca')
    expect(closed.openJiraIssue).toBeUndefined()
  })

  it('keeps a provider tab on its own list', () => {
    const opened = {
      taskSource: 'jira' as const,
      openJiraIssue: issue,
      ...taskDetailReturnFields('jira')
    }
    expect(closeTaskPageDetail(opened).taskSource).toBe('jira')
  })
})

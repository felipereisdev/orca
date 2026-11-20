import { afterEach, describe, expect, it, vi } from 'vitest'

import { getWorkerTerminalAutoReleaseScheduler } from '../../../../../orchestration/terminal-authority/release/worker-terminal-auto-release-scheduler'
import './worker-resume-session-capture'
import { createOrchestrationWorkerReleaseHarness } from '../testing/worker-release.test-support'

describe('a follow-up to a closed worker started on a named Claude account', () => {
  const h = createOrchestrationWorkerReleaseHarness()

  afterEach(() => {
    getWorkerTerminalAutoReleaseScheduler(h.runtime).clear()
    h.cleanup()
  })

  it('starts the worker again on the account it was started with', async () => {
    h.setup()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(h.runtime, 'showTerminalWorkspaceLaunchScope').mockResolvedValue({
      id: 'repo::worktree',
      path: '/work/repo',
      connectionId: null
    } as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(h.runtime, 'getClaudeAccountsSnapshot').mockReturnValue({
      accounts: [{ id: 'acct-1', email: 'dev@example.com' }],
      activeAccountId: null
    } as never)
    const task = h.db.createTask({ spec: 'review the change', runId: h.activeRunId })
    await h.call('orchestration.workerStart', {
      task: task.id,
      from: 'term_coord',
      agent: 'claude',
      claudeAccountId: 'acct-1'
    })
    const dispatchId = h.db.getDispatchContext(task.id)!.id
    h.settle(task.id, dispatchId, 'succeeded')
    await h.call('orchestration.workerRelease', { dispatch: dispatchId })
    vi.mocked(h.runtime.createTerminal).mockClear()

    await h.call('orchestration.send', {
      from: 'term_coord',
      to: `dispatch:${dispatchId}`,
      subject: 'More',
      body: 'and the docs'
    })

    await vi.waitFor(() =>
      expect(h.runtime.createTerminal).toHaveBeenCalledWith(
        'id:repo::worktree',
        expect.objectContaining({ startupAgent: 'claude', claudeAccountId: 'acct-1' })
      )
    )
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getWorkerTerminalAutoReleaseScheduler } from '../../../../../orchestration/terminal-authority/release/worker-terminal-auto-release-scheduler'
import { getFollowUpDispatch } from '../../../../../orchestration/db/dispatch-context/worker-follow-up-lineage'
import './worker-resume-session-capture'
import { continueAllUnreadWorkerMail } from '../../messaging/settled-worker-follow-through'
import { createOrchestrationWorkerReleaseHarness } from '../testing/worker-release.test-support'

// A send to a finished terminal worker, through the same worker-start the coordinator would run.
describe('a follow-up to a finished terminal worker', () => {
  const h = createOrchestrationWorkerReleaseHarness()
  let userDataDir: string | undefined

  afterEach(() => {
    getWorkerTerminalAutoReleaseScheduler(h.runtime).clear()
    h.cleanup()
    if (userDataDir) {
      rmSync(userDataDir, { recursive: true, force: true })
      userDataDir = undefined
    }
  })

  const send = (dispatchId: string, body: string) =>
    h.call('orchestration.send', {
      from: 'term_coord',
      to: `dispatch:${dispatchId}`,
      subject: 'More',
      body
    })

  it('retries a follow-up a restart interrupted before it placed an agent, with the mail it took', async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-follow-up-midstart-'))
    h.setup({ userDataDir })
    const { taskId, dispatchId } = await h.startWorker()
    await send(dispatchId, 'DO NOT PUSH')
    h.settle(taskId, dispatchId, 'succeeded')
    // The claim commits; the app quits before the start places an agent.
    const claimed = h.db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: 9,
      taskSpec: 'New messages',
      taskRunId: h.activeRunId,
      startOptions: { agent: 'codex' },
      runtimeEpoch: 'runtime_before_restart',
      followUpOf: dispatchId,
      takesMailOf: dispatchId
    }).dispatch.id

    h.restart()

    await vi.waitFor(() => expect(getFollowUpDispatch(h.db, claimed)).toBeDefined())
    const retry = getFollowUpDispatch(h.db, claimed)!
    await vi.waitFor(() =>
      expect(h.db.getUnreadMessages(`dispatch:${retry.id}`)).toMatchObject([
        { body: 'DO NOT PUSH' }
      ])
    )
  })

  it('starts a closed worker again on the account it was started with', async () => {
    h.setup()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(h.runtime, 'showTerminalWorkspaceLaunchScope').mockResolvedValue({
      id: 'repo::worktree',
      path: '/work/repo',
      connectionId: null
    } as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(h.runtime, 'getAccountsSnapshot').mockReturnValue({
      claude: { accounts: [{ id: 'acct-1', email: 'dev@example.com' }], activeAccountId: null }
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

    await send(dispatchId, 'and the docs')

    await vi.waitFor(() =>
      expect(h.runtime.createTerminal).toHaveBeenCalledWith(
        'id:repo::worktree',
        expect.objectContaining({ startupAgent: 'claude', claudeAccountId: 'acct-1' })
      )
    )
  })

  it('keeps the mail a stopped follow-up never read for the next send, without restarting it', async () => {
    h.setup()
    const { taskId, dispatchId } = await h.startWorker()
    await send(dispatchId, 'DO NOT PUSH')
    h.settle(taskId, dispatchId, 'succeeded')
    continueAllUnreadWorkerMail(h.runtime, h.db)
    await vi.waitFor(() =>
      expect(h.db.getWorkerDispatch(getFollowUpDispatch(h.db, dispatchId)?.id ?? '')?.state).toBe(
        'ready'
      )
    )
    const stopped = getFollowUpDispatch(h.db, dispatchId)!.id
    h.db.beginWorkerStop(stopped, h.runtime.getRuntimeId())
    h.db.settleWorkerStop(stopped)

    continueAllUnreadWorkerMail(h.runtime, h.db)
    expect(getFollowUpDispatch(h.db, stopped)).toBeUndefined()

    await send(dispatchId, 'and the docs')
    const next = getFollowUpDispatch(h.db, stopped)!
    await vi.waitFor(() =>
      expect(h.db.getUnreadMessages(`dispatch:${next.id}`)).toMatchObject([{ body: 'DO NOT PUSH' }])
    )
  })
})

import { describe, expect, it, vi } from 'vitest'
import { getDefaultUIState } from '../../../../../shared/orca-profiles/constants'
import type { OrchestrationCompatibilityEvidence } from '../../../../../shared/orchestration/orchestration-compatibility-evidence'
import { testOrcaSessionId } from '../../../../../shared/agent-session/identity/orca-session-address-test-fixture'
import type { TaskStartOrchestratorRef } from '../../../../../shared/task-board/task-start-run'
import { getTaskStartRunStore } from '../../../../task-board/task-start-lifecycle-deps'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { partialRuntimeStore } from '../../../orca-runtime-tests/runtime-store-partial-fixture'
import type { RpcContext } from '../../core'
import { ORCHESTRATION_TASK_START_METHODS } from './task-start-phase'

const CHAT_SESSION = testOrcaSessionId('11111111-1111-4111-8111-111111111111')
const OTHER_SESSION = testOrcaSessionId('22222222-2222-4222-8222-222222222222')
const ORCHESTRATOR_PANE = 'tab_orch:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKER_PANE = 'tab_work:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function setup() {
  let ui = getDefaultUIState()
  const runtime = new OrcaRuntimeService(
    partialRuntimeStore({
      getUI: () => ui,
      updateUI: (updates) => {
        ui = { ...ui, ...updates }
      }
    })
  )
  // Any terminal Orca launched verifies; only the run's orchestrator may report.
  vi.spyOn(runtime, 'verifyOrchestrationCompatibilityCaller').mockImplementation((evidence) =>
    evidence?.terminalHandle && evidence.paneKey
      ? {
          hostScope: { kind: 'local', hostId: 'local' },
          terminalHandle: evidence.terminalHandle,
          paneKey: evidence.paneKey,
          processIncarnation: `${evidence.terminalHandle}:1`,
          launchTokenHash: 'hash'
        }
      : null
  )
  const store = getTaskStartRunStore(runtime)
  const publish = (cardKey: string, orchestrator: TaskStartOrchestratorRef) => {
    const claimed = store.claim({ cardKey, repoId: 'r', workspaceMode: 'worktree' })
    if (!claimed.ok) {
      throw new Error('claim failed')
    }
    return store.transition(claimed.run.id, ['running'], { launch: 'published', orchestrator })!
  }
  const chatRun = publish('jira:a:APP-1', {
    hostId: 'local',
    agent: 'claude',
    worktreeId: 'wt-1',
    surface: 'chat',
    sessionId: CHAT_SESSION
  })
  const terminalRun = publish('jira:a:APP-2', {
    hostId: 'local',
    agent: 'claude',
    worktreeId: 'wt-2',
    surface: 'terminal',
    handle: 'term_orch',
    paneKey: ORCHESTRATOR_PANE
  })
  return { runtime, store, chatRun, terminalRun }
}

function chatCaller(runtime: OrcaRuntimeService, sessionId = CHAT_SESSION): RpcContext {
  return {
    runtime,
    orchestrationCaller: {
      address: `orca_session_id:${sessionId}`,
      orcaSessionId: sessionId,
      sessionId,
      workspaceId: 'wt-1',
      terminalHandle: null,
      paneKey: null
    }
  }
}

function terminalCaller(runtime: OrcaRuntimeService, handle: string, paneKey: string): RpcContext {
  const evidence: OrchestrationCompatibilityEvidence = {
    terminalHandle: handle,
    paneKey,
    launchToken: 'token'
  }
  return { runtime, orchestrationCompatibilityEvidence: evidence }
}

function reportPhase(params: Record<string, unknown>, ctx: RpcContext) {
  const [method] = ORCHESTRATION_TASK_START_METHODS
  return Promise.resolve().then(() => method.handler(method.params.parse(params), ctx))
}

describe('orchestration.taskStartPhase', () => {
  it('accepts the run orchestrator calling from its chat', async () => {
    const { runtime, store, chatRun } = setup()

    await reportPhase({ phase: 'planning' }, chatCaller(runtime))

    expect(store.getById(chatRun.id)).toMatchObject({ state: 'running', phase: 'planning' })
  })

  it('accepts the run orchestrator calling from its terminal', async () => {
    const { runtime, store, terminalRun } = setup()

    await reportPhase({ phase: 'waiting' }, terminalCaller(runtime, 'term_orch', ORCHESTRATOR_PANE))

    expect(store.getById(terminalRun.id)).toMatchObject({ state: 'waiting', phase: 'starting' })
  })

  it('refuses a worker terminal or another chat and leaves every run as it was', async () => {
    const { runtime, store, chatRun, terminalRun } = setup()
    const before = [store.getById(chatRun.id), store.getById(terminalRun.id)]

    await expect(
      reportPhase({ phase: 'qa' }, terminalCaller(runtime, 'term_worker', WORKER_PANE))
    ).rejects.toMatchObject({ code: 'not_task_orchestrator' })
    await expect(
      reportPhase({ phase: 'qa' }, chatCaller(runtime, OTHER_SESSION))
    ).rejects.toMatchObject({ code: 'not_task_orchestrator' })

    expect([store.getById(chatRun.id), store.getById(terminalRun.id)]).toEqual(before)
  })

  it('reports development progress as the card percent', async () => {
    const { runtime } = setup()

    const result = await reportPhase(
      { phase: 'development', current: 3, total: 7, step: 'reviewing' },
      chatCaller(runtime)
    )

    expect(result.run).toMatchObject({
      phase: 'development',
      progress: { current: 3, total: 7, step: 'reviewing' },
      percent: 51
    })
  })
})

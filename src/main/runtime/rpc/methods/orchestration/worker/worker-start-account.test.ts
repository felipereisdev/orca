import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../../core'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'
import type { OrchestrationDb } from '../../../../orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { EVERY_AGENT_CHAT } from '../../../../../../shared/native-chat/every-agent-chat.test-fixture'
import { createStructuredAgentSessionForWorktree } from '../../structured-sessions/creation/structured-agent-session-create'
import '../../../../../../shared/orca-profiles/constants'
import '../../../../orchestration/workers/launch/worker-dispatch-preamble'

vi.mock('../../structured-sessions/creation/structured-agent-session-create', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // A definitive refusal proves no session exists, so the failed start has nothing to clean up.
  createStructuredAgentSessionForWorktree: vi.fn(async () => ({
    ok: false,
    refusal: { code: 'structured_agent_session_unsupported', message: 'test host' }
  }))
}))

describe('worker-start --account', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext

  afterEach(() => {
    h.cleanup()
    vi.clearAllMocks()
  })

  function setup(): void {
    ;({ db, runtime, ctx } = h.setup())
    vi.mocked(runtime.getTerminalPaneKey).mockImplementation((handle) =>
      handle === 'term_coord'
        ? h.coordinatorPaneKey
        : handle === 'term_worker'
          ? 'tab_worker:leaf_worker'
          : null
    )
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal').mockImplementation(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
      async (handle) => ({ handle, worktreeId: 'repo::worktree', status: 'running' }) as never
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::worktree',
      repoId: 'repo'
    } as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(runtime, 'showTerminalWorkspaceLaunchScope').mockResolvedValue({
      id: 'repo::worktree',
      path: '/work/repo',
      connectionId: null
    } as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(runtime, 'getClaudeAccountsSnapshot').mockReturnValue({
      accounts: [{ id: 'acct-1', email: 'dev@example.com', authMethod: 'subscription-oauth' }],
      activeAccountId: null
    } as never)
    vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'term_worker',
      worktreeId: 'repo::worktree',
      title: 'worker'
    })
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_worker',
      accepted: true,
      bytesWritten: 1
    })
  }

  function start(params: Record<string, unknown>) {
    const task = db.createTask({ spec: 'review the change' })
    return h.call(
      'orchestration.workerStart',
      { task: task.id, from: 'term_coord', claudeAccountId: 'acct-1', ...params },
      ctx
    )
  }

  it('launches a Claude terminal worker in an existing worktree on the chosen account', async () => {
    setup()

    await expect(start({ agent: 'claude', worktree: 'current' })).resolves.toMatchObject({
      state: 'ready'
    })

    expect(runtime.createTerminal).toHaveBeenCalledWith(
      'id:repo::worktree',
      expect.objectContaining({ startupAgent: 'claude', claudeAccountId: 'acct-1' })
    )
  })

  it('creates a structured Claude worker session on the chosen account', async () => {
    setup()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: mode selection reads only getSettings.
    vi.spyOn(runtime, 'requireStore').mockReturnValue({
      getSettings: () => ({
        nativeChatProviders: EVERY_AGENT_CHAT,
        agentCmdOverrides: {},
        agentDefaultArgs: {},
        agentDefaultEnv: {}
      })
    } as never)
    vi.spyOn(runtime, 'getStructuredAgentSessionCreateSupport').mockResolvedValue({
      supported: true
    })

    await start({ agent: 'claude', worktree: 'current' })

    expect(createStructuredAgentSessionForWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', claudeAccountId: 'acct-1' })
    )
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('refuses an account for an agent other than Claude', async () => {
    setup()

    await expect(start({ agent: 'codex', worktree: 'current' })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('refuses an account for an SSH destination before creating its worktree', async () => {
    setup()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worker-start reads only these fields of the stubbed record.
    vi.spyOn(runtime, 'showRepo').mockResolvedValue({
      id: 'repo-ssh',
      path: '/home/dev/repo',
      kind: 'git',
      connectionId: 'ssh-1'
    } as never)
    const createWorktree = vi.spyOn(runtime, 'createManagedWorktree')

    await expect(
      start({ agent: 'claude', worktree: 'new-top-level', repo: 'id:repo-ssh', name: 'review' })
    ).rejects.toMatchObject({ code: 'account_unsupported_remote' })
    expect(createWorktree).not.toHaveBeenCalled()
  })
})

import { expect, it } from 'vitest'
import { databaseSessionQueryActor } from './database-session-query'
import { OrcaRuntimeService } from '../orca-runtime'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
it('does not let a calling agent select another session to read its database results', async () => {
  const sessionId = testOrcaSessionId('11111111-1111-4111-8111-111111111111')
  await expect(
    databaseSessionQueryActor(
      {
        runtime: new OrcaRuntimeService(),
        caller: { kind: 'local-cli' },
        orchestrationCaller: {
          address: 'orca_session_id:11111111-1111-4111-8111-111111111111',
          orcaSessionId: sessionId,
          sessionId,
          workspaceId: 'folder:crm',
          terminalHandle: null,
          paneKey: null
        }
      },
      {
        worktree: 'folder:crm',
        sessionId: '22222222-2222-4222-8222-222222222222',
        queryId: '33333333-3333-4333-8333-333333333333'
      }
    )
  ).rejects.toThrow('Calling agents may only read their own database queries')
})

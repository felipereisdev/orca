import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { NativeChatDatabaseQueryCard } from './NativeChatDatabaseQueryCard'
const source = {
  connectionId: '11111111-1111-4111-8111-111111111111',
  connectionRevision: 1,
  alias: 'faturacao-hmg',
  engine: 'postgres' as const,
  environment: 'HMG',
  executionHostId: 'runtime:gateway' as const,
  controllerRuntimeId: 'controller'
}
export const completed = defineFixture({
  width: 640,
  render: () => (
    <div className="native-chat-appearance bg-background p-4">
      <NativeChatDatabaseQueryCard
        worktreeId="billing"
        sessionId="agent-a"
        controllerRuntimeId="controller"
        queryId="11111111-1111-4111-8111-111111111112"
        source={source}
        status="completed"
      />
    </div>
  )
})
export const expired = defineFixture({
  width: 390,
  render: () => (
    <div className="native-chat-appearance bg-background p-4">
      <NativeChatDatabaseQueryCard
        worktreeId="billing"
        sessionId="agent-a"
        controllerRuntimeId="controller"
        queryId="11111111-1111-4111-8111-111111111112"
        source={source}
        status="expired"
      />
    </div>
  )
})

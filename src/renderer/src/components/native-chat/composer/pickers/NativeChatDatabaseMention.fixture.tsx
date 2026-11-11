import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { NativeChatMentionMenu } from './NativeChatAutocompleteMenus'
export const collision = defineFixture({
  width: 520,
  render: () => (
    <div className="native-chat-appearance bg-background p-4 text-foreground">
      <div className="h-72" />
      <div className="relative h-20">
        <NativeChatMentionMenu
          mention={{
            files: ['faturacao-hmg', 'src/faturacao.ts'],
            loading: false,
            failed: false,
            databases: [
              {
                reference: {
                  kind: 'database',
                  connectionId: '11111111-1111-4111-8111-111111111111',
                  controllerRuntimeId: 'controller',
                  aliasAtSelection: 'faturacao-hmg'
                },
                engine: 'PostgreSQL',
                environment: 'HMG',
                executionHostId: 'runtime:gateway'
              }
            ]
          }}
          activeIndex={2}
          listboxId="database-mention-fixture"
          onChoose={() => {}}
        />
      </div>
    </div>
  )
})

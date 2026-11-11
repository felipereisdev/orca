import { expect, it } from 'vitest'
import { harness, listing } from './agent-model-catalog-account-list-test-support'

it('keeps model catalogs separate for two explicit Claude accounts', async () => {
  const { service } = harness('claude', {
    probes: {
      claude: async (home) =>
        listing(
          home && 'path' in home && home.path === '/account/work'
            ? ['work-model']
            : ['personal-model']
        )
    }
  })
  const read = (path: string) =>
    service.read({
      agent: 'claude',
      accountHome: { variable: 'CLAUDE_CONFIG_DIR', path },
      waitForListing: true
    })
  expect(await read('/account/work')).toMatchObject({ models: [{ id: 'work-model' }] })
  expect(await read('/account/personal')).toMatchObject({ models: [{ id: 'personal-model' }] })
  expect(await read('/account/work')).toMatchObject({ models: [{ id: 'work-model' }] })
})

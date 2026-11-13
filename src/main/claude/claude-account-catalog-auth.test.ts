import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createClaudeModelCatalogProbe } from './model-catalog/claude-model-catalog-probe'
import { harness } from '../native-chat/agent-model-catalog/agent-model-catalog-account-list-test-support'

it('discovers an explicit account through a child with that profile and no inherited credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-account-models-'))
  try {
    const script = join(root, 'claude.cjs')
    writeFileSync(
      script,
      `
let input = ''
process.stdin.on('data', chunk => input += chunk)
process.stdin.on('end', () => {
  const wrong = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_CUSTOM_HEADERS
  const model = wrong ? 'inherited-account-model' : process.env.ORCA_CLAUDE_ACCOUNT_ID === 'work' ? 'work-model' : 'default-model'
  console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'orca-model-discovery', response: { models: [{ value: model, displayName: model }] } } }))
})
`
    )
    const probe = createClaudeModelCatalogProbe({
      resolveCommand: () => ({ command: process.execPath, prefixArgs: [script] }),
      resolveInheritedEnv: async () => ({
        PATH: process.env.PATH ?? '',
        HOME: root,
        ANTHROPIC_API_KEY: 'personal-api-key',
        CLAUDE_CODE_OAUTH_TOKEN: 'personal-oauth',
        ANTHROPIC_CUSTOM_HEADERS: 'Authorization: personal-header'
      }),
      resolveAuthPolicy: () => ({ account: 'system' })
    })
    const { service } = harness('claude', { probes: { claude: probe } })
    const request = {
      agent: 'claude',
      accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: join(root, 'work') },
      claudeAccountId: 'work',
      waitForListing: true
    }
    expect(await service.read(request)).toMatchObject({ models: [{ id: 'work-model' }] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

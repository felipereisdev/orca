import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, SUPPORTED } from './helpers/structured-claude-stub'
import { expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { waitForTerminalOutput } from './helpers/terminal'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'

test.use({ seedTestRepo: false })

async function choose(page: Page, label: string, surface: 'terminal' | 'chat') {
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('button', { name: `Configure Claude (${label})`, exact: true }).click()
  await page
    .getByRole('button', {
      name: surface === 'chat' ? 'Launch chat' : 'Launch terminal',
      exact: true
    })
    .click()
}

function launches(file: string): { accountId?: string; configDir?: string; args: string[] }[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []
}

test('launches both Claude accounts in Terminal and Chat without changing their binding', async ({
  orcaPage: page,
  electronApp,
  claudeStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'The scripted Claude wrapper is POSIX-only')
  await waitForSessionReady(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  const root = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const folder = join(root, 'account-workspace')
  mkdirSync(folder)
  const accounts = ['personal', 'work'].map((id) => {
    const home = join(root, 'claude-profiles', id, 'home')
    mkdirSync(home, { recursive: true })
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: `${id}@example.test` } })
    )
    writeFileSync(join(home, '..', 'profile.json'), '{}')
    return {
      id,
      label: id === 'work' ? 'Empresa' : 'Pessoal',
      email: `${id}@example.test`,
      managedAuthPath: '',
      authMethod: 'subscription-oauth' as const,
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    }
  })
  await page.evaluate(
    async ({ folder, accounts, command }) => {
      const store = window.__store!
      await store.getState().updateSettings({
        uiLanguage: 'en',
        theme: 'dark',
        defaultTuiAgent: 'claude',
        nativeChatProviders: { claude: true, codex: true },
        agentCmdOverrides: { claude: command },
        agentDefaultArgs: { claude: '' },
        claudeManagedAccounts: accounts,
        activeClaudeManagedAccountId: 'personal'
      })
      const group = await window.api.projectGroups.create({ name: 'Accounts', parentPath: folder })
      const workspace = await window.api.folderWorkspaces.create({
        projectGroupId: group.id,
        name: 'Accounts',
        folderPath: folder
      })
      await store
        .getState()
        .fetchFolderWorkspaces({ runtimeEnvironmentId: null, throwOnError: true })
      store.getState().setActiveFolderWorkspace(workspace.id)
    },
    { folder, accounts, command: buildFakeAgentCommandOverride(claudeStub.command) }
  )

  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Configure Claude (Empresa)', exact: true })
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('accounts-menu.png') })
  await page.keyboard.press('Escape')

  for (const [terminalLabel, terminalId, chatLabel, chatId, defaultId] of [
    ['Empresa', 'work', 'Pessoal', 'personal', 'work'],
    ['Pessoal', 'personal', 'Empresa', 'work', 'personal']
  ]) {
    await choose(page, terminalLabel, 'terminal')
    await waitForTerminalOutput(page, `ACCOUNT:${terminalId}`, 20_000)
    await page.screenshot({ path: testInfo.outputPath(`terminal-${terminalId}.png`) })
    await choose(page, chatLabel, 'chat')
    await page.evaluate(
      async (accountId) => window.api.claudeAccounts.select({ accountId }),
      defaultId
    )
    const chat = page.locator('[data-native-chat-root="true"]:visible')
    await chat.getByRole('textbox').fill('Hello')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() =>
        launches(claudeStub.launchLog)
          .filter((launch) => launch.accountId === chatId && launch.args.includes('stream-json'))
          .map((launch) => launch.configDir)
      )
      .toContain(join(root, 'claude-profiles', chatId, 'home'))
    await expect(chat.getByText(chatLabel, { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`chat-${chatId}.png`) })
  }
})

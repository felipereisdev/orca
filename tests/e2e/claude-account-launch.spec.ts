import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, SUPPORTED } from './helpers/structured-claude-stub'
import { expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { waitForTerminalOutput } from './helpers/terminal'

test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: { ANTHROPIC_CUSTOM_HEADERS: 'Authorization: test-other-account' }
})

async function choose(page: Page, label: string, surface: 'terminal' | 'chat') {
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page
    .getByRole('button', { name: `Configure Claude (${label})`, exact: true })
    .press('ArrowRight')
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
    async ({ folder, command }) => {
      const store = window.__store!
      await store.getState().updateSettings({
        uiLanguage: 'en',
        theme: 'dark',
        claudeCodeThemeSyncOffer: 'settled',
        defaultTuiAgent: 'claude',
        nativeChatProviders: { claude: true, codex: true },
        agentCmdOverrides: { claude: command },
        agentDefaultArgs: { claude: '' },
        claudeManagedAccounts: [],
        activeClaudeManagedAccountId: null
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
    { folder, command: 'claude' }
  )

  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Configure Claude', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(async (accounts) => {
    await window.__store!.getState().updateSettings({
      claudeManagedAccounts: accounts,
      activeClaudeManagedAccountId: 'personal'
    })
  }, accounts)
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Configure Claude (Empresa)', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Configure Claude', exact: true })
  ).not.toBeAttached()
  await page.screenshot({ path: testInfo.outputPath('accounts-menu.png') })
  await page.keyboard.press('Escape')

  await page.evaluate(async () => {
    const store = window.__store!
    await store.getState().updateSettings({
      activeRuntimeEnvironmentId: 'disconnected-default-host',
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
    })
    const limits = (usedPercent: number) => ({
      provider: 'claude' as const,
      session: null,
      weekly: { usedPercent, windowMinutes: 10_080, resetsAt: null, resetDescription: null },
      status: 'ok' as const,
      updatedAt: Date.now(),
      error: null
    })
    store.setState({
      statusBarVisible: true,
      statusBarItems: ['claude'],
      detectedAgentIds: null,
      usagePercentageDisplay: 'used',
      fetchInactiveClaudeAccountUsage: async () => {},
      rateLimits: {
        ...store.getState().rateLimits,
        claude: limits(91),
        inactiveClaudeAccounts: [
          {
            accountId: 'personal',
            rateLimits: limits(18),
            updatedAt: Date.now(),
            isFetching: false
          },
          { accountId: 'work', rateLimits: limits(3), updatedAt: Date.now(), isFetching: false }
        ]
      }
    })
  })
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Claude/ }).press('ArrowRight')
  const usageAccount = page.getByRole('combobox', { name: 'Claude Account', exact: true })
  await expect(usageAccount).toHaveText('Pessoal')
  await expect(page.getByText('18% used', { exact: true })).toBeVisible()
  await usageAccount.click()
  await expect(page.getByRole('option', { name: 'System default', exact: true })).not.toBeAttached()
  await page.getByRole('option', { name: 'Empresa', exact: true }).click()
  await expect(usageAccount).toHaveText('Empresa')
  await expect(page.getByText('3% used', { exact: true })).toBeVisible()
  await usageAccount.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Empresa', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('option', { name: 'Empresa', exact: true })).not.toBeAttached()
  await expect(usageAccount).toBeFocused()
  await expect(usageAccount).toBeVisible()
  expect(
    await page.evaluate(async () => (await window.api.claudeAccounts.list()).activeAccountId)
  ).toBeNull()
  await page.screenshot({ path: testInfo.outputPath('account-usage-selector.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ claudeManagedAccounts: [] })
  })
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Claude/ }).press('ArrowRight')
  await expect(usageAccount).toHaveText('System default')
  await expect(page.getByText('91% used', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(async (accounts) => {
    await window.__store!.getState().updateSettings({
      claudeManagedAccounts: accounts,
      activeRuntimeEnvironmentId: null,
      activeClaudeManagedAccountId: 'personal',
      activeClaudeManagedAccountIdsByRuntime: { host: 'personal', wsl: {} }
    })
  }, accounts)

  for (const [label, draft] of [
    ['Pessoal', 'private draft'],
    ['Empresa', 'company draft']
  ]) {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await page.getByRole('button', { name: `Configure Claude (${label})`, exact: true }).click()
    const panel = page.getByRole('menu', { name: `Configure Claude (${label})`, exact: true })
    await expect(panel.getByRole('textbox').last()).toBeEmpty()
    await panel.getByRole('textbox').last().fill(draft)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }
  for (const [label, draft] of [
    ['Pessoal', 'private draft'],
    ['Empresa', 'company draft']
  ]) {
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await page.getByRole('button', { name: `Configure Claude (${label})`, exact: true }).click()
    const composer = page
      .getByRole('menu', { name: `Configure Claude (${label})`, exact: true })
      .getByRole('textbox')
      .last()
    await expect(composer).toHaveText(draft)
    await composer.fill('')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }

  for (const [terminalLabel, terminalId, chatLabel, chatId, defaultId] of [
    ['Empresa', 'work', 'Pessoal', 'personal', 'work'],
    ['Pessoal', 'personal', 'Empresa', 'work', 'personal']
  ]) {
    await choose(page, terminalLabel, 'terminal')
    await waitForTerminalOutput(page, `ACCOUNT:${terminalId}`, 20_000)
    await expect
      .poll(() =>
        launches(claudeStub.launchLog)
          .filter(
            (launch) => launch.accountId === terminalId && !launch.args.includes('stream-json')
          )
          .map((launch) => launch.configDir)
      )
      .toContain(join(root, 'claude-profiles', terminalId, 'home'))
    await waitForTerminalOutput(page, 'AUTH_HEADERS:clean', 10_000)
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

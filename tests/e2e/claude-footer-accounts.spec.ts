import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import type { Page } from '@stablyai/playwright-test'

test.use({ seedTestRepo: false })

async function seedUsage(page: Page) {
  await page.evaluate(() => {
    const store = window.__store!
    const limits = (usedPercent: number) => ({
      provider: 'claude' as const,
      session: null,
      weekly: { usedPercent, windowMinutes: 10_080, resetsAt: null, resetDescription: null },
      updatedAt: Date.now(),
      status: 'ok' as const,
      error: null
    })
    store.setState({
      statusBarVisible: true,
      statusBarItems: ['claude'],
      statusBarUsageMode: 'compact',
      detectedAgentIds: null,
      usagePercentageDisplay: 'used',
      fetchInactiveClaudeAccountUsage: async () => {},
      rateLimits: {
        ...store.getState().rateLimits,
        claude: limits(91),
        inactiveClaudeAccounts: [
          { accountId: 'work', rateLimits: limits(3), updatedAt: Date.now(), isFetching: false },
          {
            accountId: 'personal',
            rateLimits: limits(18),
            updatedAt: Date.now(),
            isFetching: false
          }
        ]
      }
    })
  })
}

async function openAccounts(page: Page) {
  await page.locator('[data-orca-status-bar]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Claude Usage', exact: true }).press('ArrowRight')
}

test('pins independent Claude usage accounts and retains the selection after reload', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  await waitForSessionReady(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  const root = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const accounts = ['work', 'personal'].map((id) => {
    const home = join(root, 'claude-profiles', id, 'home')
    mkdirSync(home, { recursive: true })
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: `${id}@example.test` } })
    )
    writeFileSync(join(home, '..', 'profile.json'), '{}')
    return {
      id,
      label: id === 'work' ? 'Ucloud' : 'Pessoal',
      email: `${id}@example.test`,
      managedAuthPath: '',
      authMethod: 'subscription-oauth' as const,
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    }
  })
  await page.evaluate(async (accounts) => {
    window.__store!.setState({ fetchInactiveClaudeAccountUsage: async () => {} })
    await window.__store!.getState().updateSettings({
      uiLanguage: 'en',
      claudeManagedAccounts: accounts,
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
    })
    await window.api.ui.set({ statusBarItems: ['claude'], statusBarUsageMode: 'compact' })
  }, accounts)
  await seedUsage(page)
  await openAccounts(page)
  await expect(page.getByRole('menuitemcheckbox', { name: 'Ucloud', exact: true })).toBeChecked()
  await page.getByRole('menuitemcheckbox', { name: 'Pessoal', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const usage = page.getByRole('button', { name: 'Usage', exact: true })
  await expect(usage.getByText('Ucloud', { exact: true })).toBeVisible()
  await expect(usage.getByText('Pessoal', { exact: true })).toBeVisible()
  await expect(usage).toContainText('3%')
  await expect(usage).toContainText('18%')
  await expect(usage).not.toContainText('91%')
  await page.evaluate(() => {
    const store = window.__store!
    const state = store.getState()
    store.setState({
      rateLimits: {
        ...state.rateLimits,
        claude: {
          ...state.rateLimits.claude!,
          weekly: { ...state.rateLimits.claude!.weekly!, usedPercent: 3 }
        }
      },
      refreshRateLimits: async () => {},
      refreshDetectedAgents: async () => [],
      fetchInactiveClaudeAccountUsage: async () => {
        const latest = store.getState().rateLimits
        store.setState({
          rateLimits: {
            ...latest,
            inactiveClaudeAccounts: latest.inactiveClaudeAccounts.map((account) =>
              account.accountId === 'work'
                ? {
                    ...account,
                    rateLimits: {
                      ...account.rateLimits!,
                      weekly: {
                        ...account.rateLimits!.weekly!,
                        usedPercent: latest.claude!.weekly!.usedPercent
                      }
                    }
                  }
                : account
            )
          }
        })
      }
    })
  })
  await expect(usage).toContainText('3%')
  await page.evaluate(() => {
    const store = window.__store!
    const state = store.getState().rateLimits
    store.setState({
      rateLimits: {
        ...state,
        claude: { ...state.claude!, weekly: { ...state.claude!.weekly!, usedPercent: 13 } }
      }
    })
  })
  await usage.click()
  await page.getByRole('menuitem', { name: 'Refresh rate limits', exact: true }).click()
  await expect(usage).toContainText('13%')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: testInfo.outputPath('two-footer-accounts.png') })
  await page.setViewportSize({ width: 340, height: 800 })
  await expect(usage.locator('[data-usage-chip][data-usage-collapsed=true]')).toHaveCount(1)
  await expect(usage.getByText('Ucloud', { exact: true })).toBeVisible()
  await expect(usage.getByText('Pessoal', { exact: true })).not.toBeVisible()
  await expect.poll(() => usage.locator('[data-usage-more]').innerText()).toBe('+1')
  await page.screenshot({ path: testInfo.outputPath('footer-account-overflow.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(usage.getByText('Pessoal', { exact: true })).toBeVisible()
  await openAccounts(page)
  await page.getByRole('menuitemcheckbox', { name: 'Ucloud', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(usage.getByText('Ucloud', { exact: true })).not.toBeAttached()
  await expect(usage.getByText('Pessoal', { exact: true })).toBeVisible()
  await page.reload()
  await waitForSessionReady(page)
  await seedUsage(page)
  await expect(usage.getByText('Ucloud', { exact: true })).not.toBeAttached()
  await expect(usage.getByText('Pessoal', { exact: true })).toBeVisible()
  await openAccounts(page)
  await page.getByRole('menuitemcheckbox', { name: 'Pessoal', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(usage).toBeVisible()
  await expect(usage.getByText('Pessoal', { exact: true })).not.toBeAttached()
  expect(
    await page.evaluate(async () => (await window.api.claudeAccounts.list()).activeAccountId)
  ).toBeNull()
})

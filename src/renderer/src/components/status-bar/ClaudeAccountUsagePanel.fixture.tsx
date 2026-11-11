import { defineFixture } from '../../component-fixtures/component-fixture'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { ClaudeAccountUsagePanel } from './ClaudeAccountUsagePanel'
import { buildClaudeStatusSwitchGroups } from './status-bar-claude-accounts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'

const now = Date.now()
const accounts = [
  {
    id: 'work',
    label: 'Ucloud',
    email: 'empresa@example.test',
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  },
  {
    id: 'personal',
    label: 'Pessoal',
    email: 'pessoal@example.test',
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
]
const limits: ProviderRateLimits = {
  provider: 'claude',
  status: 'ok',
  error: null,
  updatedAt: now - 60_000,
  session: {
    usedPercent: 12,
    windowMinutes: 300,
    resetsAt: now + 222 * 60_000,
    resetDescription: null
  },
  weekly: {
    usedPercent: 3,
    windowMinutes: 10_080,
    resetsAt: now + 6 * 86400_000,
    resetDescription: null
  },
  fableWeekly: {
    usedPercent: 0,
    windowMinutes: 10_080,
    resetsAt: now + 6 * 86400_000,
    resetDescription: null
  }
}

function fixture({
  width = 520,
  empty = false,
  loading = false,
  long = false,
  signedOut = false,
  missing = false,
  error = false,
  openSelect = false
} = {}) {
  const roster = {
    accounts: empty
      ? []
      : accounts.map((account) => ({
          ...account,
          ...(long
            ? { label: 'Ucloud — Equipe de desenvolvimento e operações internacionais' }
            : {}),
          ...(signedOut ? { needsSignIn: true as const } : {})
        })),
    activeAccountId: null
  }
  const group = buildClaudeStatusSwitchGroups(
    roster,
    { runtime: 'host', wslDistro: null },
    { systemDefault: 'fallback' }
  )[0]
  return defineFixture({
    width,
    render: () => (
      <div className="h-[570px] bg-background p-3">
        <DropdownMenu defaultOpen modal={false}>
          <DropdownMenuTrigger>Usage</DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[400px] max-w-[calc(100vw-1rem)]"
            style={{ maxWidth: width - 24 }}
          >
            <div className="p-2">
              <ClaudeAccountUsagePanel
                group={group}
                accounts={roster.accounts}
                loaded={!loading}
                activeUsage={
                  empty ? limits : { ...limits, weekly: { ...limits.weekly!, usedPercent: 91 } }
                }
                previews={
                  missing
                    ? []
                    : roster.accounts.map((account) => ({
                        accountId: account.id,
                        rateLimits: error
                          ? { ...limits, status: 'error', error: 'Network unavailable' }
                          : limits,
                        updatedAt: now,
                        isFetching: loading
                      }))
                }
                display="used"
                signingInId={null}
                onSignIn={() => {}}
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Manage Accounts…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
    ...(openSelect
      ? {
          interact: (frame: HTMLElement) => {
            const trigger = frame.ownerDocument.querySelector<HTMLElement>('[role="combobox"]')
            trigger?.focus()
            trigger?.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
            )
          }
        }
      : {})
  })
}

export const accountsMenu = fixture()
export const narrow = fixture({ width: 336, long: true })
export const selectorOpen = fixture({ openSelect: true })
export const noAccounts = fixture({ empty: true })
export const loading = fixture({ loading: true, empty: true })
export const signedOut = fixture({ signedOut: true })
export const missingReading = fixture({ missing: true })
export const staleError = fixture({ error: true })

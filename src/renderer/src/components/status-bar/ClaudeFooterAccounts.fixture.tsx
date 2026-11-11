import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { buildClaudeStatusSwitchGroups } from './status-bar-claude-accounts'
import { buildStatusBarUsageEntries } from './status-bar-usage-entries'
import { StatusBarUsageIndicators } from './StatusBarUsageIndicators'
import { ClaudeFooterVisibilityMenu } from './ClaudeFooterVisibilityMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const accounts = ['Ucloud', 'Pessoal'].map((label) => ({
  id: label.toLowerCase(),
  label,
  email: `${label.toLowerCase()}@example.test`,
  authMethod: 'subscription-oauth' as const,
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
}))
const group = buildClaudeStatusSwitchGroups(
  { accounts, activeAccountId: null },
  { runtime: 'host', wslDistro: null },
  { systemDefault: 'fallback' }
)[0]
function limits(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: { usedPercent, windowMinutes: 10_080, resetsAt: null, resetDescription: null },
    updatedAt: Date.now(),
    status: 'ok',
    error: null
  }
}
const usage = createEmptyRateLimitState({
  claude: limits(91),
  inactiveClaudeAccounts: accounts.map((account, index) => ({
    accountId: account.id,
    rateLimits: limits(index ? 18 : 3),
    isFetching: false,
    updatedAt: Date.now()
  }))
})

function Footer({
  collapsed = false,
  menu = false,
  empty = false
}: {
  collapsed?: boolean
  menu?: boolean
  empty?: boolean
}) {
  const [ids, setIds] = useState(empty ? [] : ['ucloud', 'pessoal'])
  const [enabled, setEnabled] = useState(true)
  const entries = buildStatusBarUsageEntries(
    [usage.claude!],
    group,
    enabled ? ids : [],
    'local',
    usage
  )
  return (
    <div className="space-y-6 bg-background p-3">
      <div className="flex h-6 items-center gap-3 whitespace-nowrap border-t border-border bg-card px-3 text-xs">
        <button className="inline-flex items-center gap-3 rounded px-1 py-0.5" aria-label="Usage">
          <StatusBarUsageIndicators
            entries={entries}
            collapsedIds={collapsed ? entries.slice(0, 1).map((entry) => entry.id) : []}
            compact={collapsed}
            mode="compact"
            display="used"
            collapseUsage={collapsed}
          />
        </button>
      </div>
      {menu ? (
        <div className="h-80">
          <DropdownMenu defaultOpen modal={false}>
            <DropdownMenuTrigger>Footer visibility</DropdownMenuTrigger>
            <DropdownMenuContent>
              <ClaudeFooterVisibilityMenu
                accounts={{
                  group,
                  scopeKey: 'local',
                  selectedIds: ids,
                  enabled,
                  setSelected: setIds,
                  entries: () => entries
                }}
                onToggleProvider={() => setEnabled(!enabled)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  )
}
export const twoAccounts = defineFixture({ width: 520, render: () => <Footer /> })
export const narrowOverflow = defineFixture({ width: 280, render: () => <Footer collapsed /> })
export const noSelection = defineFixture({ width: 336, render: () => <Footer empty /> })
export const visibilityMenu = defineFixture({
  width: 620,
  render: () => <Footer menu />,
  interact: (frame) => {
    const trigger = frame.ownerDocument.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-sub-trigger"]'
    )
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  }
})

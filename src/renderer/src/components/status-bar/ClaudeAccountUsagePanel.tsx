import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { UsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import type { ClaudeStatusSwitchGroup } from './status-bar-runtime-targets'
import { formatTimeAgo, ProviderIcon, ProviderPanel } from './tooltip'
import { InlineUsageSignInAction, InlineUsageSkeleton } from './InlineProviderUsage'
import { getProviderDisplayName } from '../../../../shared/usage-provider-windows'

export function ClaudeAccountUsagePanel({
  group,
  accounts,
  loaded,
  activeUsage,
  previews,
  display,
  signingInId,
  onSignIn
}: {
  group: ClaudeStatusSwitchGroup | undefined
  accounts: ClaudeRateLimitAccountsState['accounts']
  loaded: boolean
  activeUsage: ProviderRateLimits | null
  previews: InactiveAccountUsage[]
  display: UsagePercentageDisplay
  signingInId: string | null
  onSignIn?: (id: string) => void
}) {
  const t = useTranslate()
  const [choice, setChoice] = useState<string | null>(null)
  const targets = group?.targets ?? []
  const selected =
    targets.find((target) => JSON.stringify(target.id) === choice) ??
    targets.find((target) => target.active) ??
    targets.find((target) => !target.needsSignIn) ??
    targets[0]
  const account = accounts.find((candidate) => candidate.id === selected?.id)
  const selectedAccountId = selected?.id
  const preview = previews.find((candidate) => candidate.accountId === selected?.id)
  const limits = selected?.needsSignIn
    ? null
    : selected?.active
      ? activeUsage
      : (preview?.rateLimits ?? null)
  const pending = !loaded || (!limits && preview?.isFetching === true)

  return (
    <div className="space-y-3 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex shrink-0 items-center gap-1.5 text-sm font-medium">
          <ProviderIcon provider="claude" />
          {getProviderDisplayName('claude')}
        </div>
        <span className="min-w-0 truncate text-muted-foreground">
          {limits?.updatedAt
            ? t('auto.components.status.bar.tooltip.updatedAgo', 'Updated {{time}}', {
                time: formatTimeAgo(limits.updatedAt, t)
              })
            : t('auto.components.status.bar.tooltip.notYetUpdated', 'Not yet updated')}
        </span>
      </div>
      <Select
        value={loaded && selected ? JSON.stringify(selected.id) : undefined}
        onValueChange={setChoice}
        disabled={!loaded}
      >
        <SelectTrigger
          size="sm"
          className="w-full min-w-0"
          aria-label={t('auto.components.status.bar.StatusBar.d450654fa2', 'Claude Account')}
        >
          <SelectValue
            className="min-w-0"
            placeholder={t(
              'auto.components.status.bar.UsageRosterPanel.loadingUsage',
              'Loading usage…'
            )}
          />
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="max-w-[calc(100vw-1rem)]">
          {targets.map((target) => (
            <SelectItem
              key={JSON.stringify(target.id)}
              value={JSON.stringify(target.id)}
              className="min-w-0 [&>span:last-child]:min-w-0"
            >
              <span className="truncate">{target.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {account && account.email !== selected?.label ? (
        <div className="truncate text-2xs text-muted-foreground">{account.email}</div>
      ) : null}
      {selected?.needsSignIn ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">{selected.hint}</p>
          {onSignIn && selectedAccountId ? (
            <InlineUsageSignInAction
              accountLabel={selected.label}
              isSigningIn={signingInId === selected.id}
              disabled={signingInId !== null}
              onSignIn={() => onSignIn(selectedAccountId)}
            />
          ) : null}
        </div>
      ) : pending ? (
        <InlineUsageSkeleton />
      ) : (
        <ProviderPanel
          p={limits}
          embedded
          showResetCredits={false}
          usagePercentageDisplay={display}
        />
      )}
    </div>
  )
}

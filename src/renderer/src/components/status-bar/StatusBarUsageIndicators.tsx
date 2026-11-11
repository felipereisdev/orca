import { useTranslate } from '@/i18n/use-translate'
import type { StatusBarUsageMode } from '../../../../shared/status-bar-usage-mode'
import type { UsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import type { StatusBarUsageEntry } from './status-bar-usage-entries'
import { ProviderSegment, UsageOverflowChip, getUsageTone } from './StatusBarProviderSegment'
import {
  UsageUnitLabel,
  getUsageUnitLabelState,
  usageChipShowsPercentage
} from './usage-unit-label'

export function StatusBarUsageIndicators({
  entries,
  collapsedIds,
  compact,
  mode,
  display,
  collapseUsage
}: {
  entries: StatusBarUsageEntry[]
  collapsedIds: readonly string[]
  compact: boolean
  mode: StatusBarUsageMode
  display: UsagePercentageDisplay
  collapseUsage: boolean
}) {
  const t = useTranslate()
  const unit = getUsageUnitLabelState(entries, collapsedIds, mode, t)
  return (
    <>
      {unit !== 'absent' ? (
        <UsageUnitLabel collapsed={unit === 'collapsed'} display={display} />
      ) : null}
      {entries.length === 0 ? (
        <span>{t('auto.components.status.bar.UsageRosterPanel.title', 'Usage')}</span>
      ) : null}
      {entries.map(({ id, limits, accountLabel }) => (
        <span
          key={id}
          data-usage-chip={id}
          data-usage-urgent={getUsageTone(limits) === 'urgent'}
          data-usage-percentage={usageChipShowsPercentage(limits, mode, t)}
          data-usage-collapsed={collapsedIds.includes(id)}
          aria-hidden={collapsedIds.includes(id)}
          title={accountLabel}
          className="inline-flex data-[usage-collapsed=true]:invisible data-[usage-collapsed=true]:absolute"
        >
          <ProviderSegment
            p={limits}
            accountLabel={accountLabel}
            compact={compact}
            display={display}
            mode={mode}
          />
        </span>
      ))}
      {collapseUsage ? (
        <UsageOverflowChip
          providerCount={entries.length}
          hidden={entries.filter((entry) => collapsedIds.includes(entry.id))}
          display={display}
        />
      ) : null}
    </>
  )
}

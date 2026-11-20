import type React from 'react'
import { Container } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'

/** "N environments running" for live recipe environments; opens Settings → VMs. Hidden at zero. */
export function EphemeralVmRunningIndicator({
  iconOnly = false
}: {
  iconOnly?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const enabled = useAppStore((state) => state.settings?.experimentalEphemeralVms === true)
  const count = useAppStore((state) => state.runningEphemeralVmRuntimeCount)
  if (!enabled || count === 0) {
    return null
  }
  const label = t(
    'auto.components.status.bar.EphemeralVmRunningIndicator.running',
    '{{count}} environments running',
    { count, defaultValue_one: '{{count}} environment running' }
  )
  const openVmSettings = (): void => {
    const state = useAppStore.getState()
    state.openSettingsTarget({ pane: 'experimental', repoId: null, sectionId: 'ephemeral-vms' })
    state.openSettingsPage()
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={openVmSettings}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          aria-label={label}
        >
          <Container className="size-3 shrink-0" />
          <span className="text-[11px] tabular-nums">{iconOnly ? count : label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {t(
          'auto.components.status.bar.EphemeralVmRunningIndicator.tooltip',
          'Open VM settings to see each environment’s CPU, memory and disk'
        )}
      </TooltipContent>
    </Tooltip>
  )
}

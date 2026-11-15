import type React from 'react'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { TaskStartAgentCatalogEntry } from '../../../../shared/task-board/task-board-wire-types'
import type { TaskStartAgentChoice } from '../../../../shared/task-board/task-start-settings'

const INHERIT = '__inherit__'
const DEFAULT = '__default__'

function entryKey(agent: string, accountId: string | undefined): string {
  return `${agent}\u0000${accountId ?? ''}`
}

export function TaskStartRolePicker({
  catalog,
  value,
  invalid,
  inheritLabel,
  ariaLabel,
  onChange
}: {
  catalog: TaskStartAgentCatalogEntry[]
  value?: TaskStartAgentChoice
  invalid?: boolean
  inheritLabel?: string
  /** Names the controls for assistive tech, e.g. the role label. */
  ariaLabel?: string
  onChange: (next?: TaskStartAgentChoice) => void
}): React.JSX.Element {
  const t = useTranslate()
  const entry = value
    ? catalog.find((e) => e.agent === value.agent && e.accountId === value.accountId)
    : undefined
  const providerInvalid = value !== undefined && entry === undefined
  const model = entry?.models.find((m) => m.id === value?.model)
  const modelInvalid = entry !== undefined && value?.model !== undefined && model === undefined
  const effortInvalid =
    value?.effort !== undefined &&
    entry !== undefined &&
    model !== undefined &&
    !model.efforts.some((e) => e.id === value.effort)
  const unavailable = t('taskStart.unavailable', '{{name}} (unavailable)')
  const mark = (name: string): string => unavailable.replace('{{name}}', name)
  const prefix = ariaLabel ? `${ariaLabel}: ` : ''

  const selectProvider = (key: string): void => {
    if (key === INHERIT) {
      onChange(undefined)
      return
    }
    const next = catalog.find((e) => entryKey(e.agent, e.accountId) === key)
    if (next) {
      onChange({ agent: next.agent, ...(next.accountId ? { accountId: next.accountId } : {}) })
    }
  }
  const selectModel = (id: string): void => {
    if (!value) {
      return
    }
    const { model: _m, effort: _e, ...rest } = value
    onChange(id === DEFAULT ? rest : { ...rest, model: id })
  }
  const selectEffort = (id: string): void => {
    if (!value) {
      return
    }
    const { effort: _e, ...rest } = value
    onChange(id === DEFAULT ? rest : { ...rest, effort: id })
  }

  const providerValue = value ? entryKey(value.agent, value.accountId) : INHERIT
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Select
        value={inheritLabel === undefined && !value ? undefined : providerValue}
        onValueChange={selectProvider}
      >
        <SelectTrigger
          size="sm"
          density="compact"
          className="min-w-0 max-w-full flex-1 basis-40"
          aria-label={`${prefix}${t('taskStart.provider', 'Agent')}`}
          aria-invalid={providerInvalid || invalid ? true : undefined}
        >
          <SelectValue placeholder={t('taskStart.chooseAgent', 'Choose an agent')} />
        </SelectTrigger>
        <SelectContent>
          {inheritLabel !== undefined ? (
            <SelectItem value={INHERIT}>
              {t('taskStart.inherit', 'Inherit ({{value}})').replace('{{value}}', inheritLabel)}
            </SelectItem>
          ) : null}
          {providerInvalid && value ? (
            <SelectItem value={providerValue} disabled>
              {mark(value.accountId ? `${value.agent} (${value.accountId})` : value.agent)}
            </SelectItem>
          ) : null}
          {catalog.map((e) => (
            <SelectItem key={entryKey(e.agent, e.accountId)} value={entryKey(e.agent, e.accountId)}>
              <span className="flex items-center gap-2">
                <AgentIcon agent={e.agent} size={14} />
                {e.label}
                {e.needsSignIn ? (
                  <span className="text-muted-foreground">
                    {t('taskStart.needsSignIn', 'needs sign-in')}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={value?.model ?? DEFAULT} onValueChange={selectModel} disabled={!entry}>
        <SelectTrigger
          size="sm"
          density="compact"
          className="min-w-0 max-w-full flex-1 basis-32"
          aria-label={`${prefix}${t('taskStart.model', 'Model')}`}
          aria-invalid={modelInvalid ? true : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{t('taskStart.defaultOption', 'Default')}</SelectItem>
          {value?.model && !model ? (
            <SelectItem value={value.model} disabled>
              {modelInvalid ? mark(value.model) : value.model}
            </SelectItem>
          ) : null}
          {entry?.models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={value?.effort ?? DEFAULT} onValueChange={selectEffort} disabled={!model}>
        <SelectTrigger
          size="sm"
          density="compact"
          className="min-w-0 max-w-full flex-1 basis-24"
          aria-label={`${prefix}${t('taskStart.effort', 'Effort')}`}
          aria-invalid={effortInvalid ? true : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{t('taskStart.defaultOption', 'Default')}</SelectItem>
          {value?.effort && !model?.efforts.some((e) => e.id === value.effort) ? (
            <SelectItem value={value.effort} disabled>
              {effortInvalid ? mark(value.effort) : value.effort}
            </SelectItem>
          ) : null}
          {model?.efforts.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

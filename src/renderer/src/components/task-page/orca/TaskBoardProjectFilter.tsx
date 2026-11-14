import React from 'react'
import { ChevronsUpDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { TaskBoardProjectOption } from '@/lib/work-items/task-board/task-board-project-filter'
import type { TaskProvider } from '../../../../../shared/work-items/task-providers'

export function TaskBoardProjectFilter({
  options,
  providerLabels,
  onToggle,
  onClear
}: {
  options: readonly TaskBoardProjectOption[]
  providerLabels: Readonly<Partial<Record<TaskProvider, string>>>
  onToggle: (option: TaskBoardProjectOption) => void
  onClear: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const selected = options.filter((option) => option.selected)
  const allLabel = t('taskBoard.projects.all', 'All projects')
  const triggerLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0].label
        : t('taskBoard.projects.count', '{{count}} projects', { count: selected.length })
  const groups = options.reduce<Map<TaskProvider, TaskBoardProjectOption[]>>(
    (byProvider, option) => {
      byProvider.set(option.provider, [...(byProvider.get(option.provider) ?? []), option])
      return byProvider
    },
    new Map()
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('taskBoard.projects.filter', 'Filter by project')}
          className={cn(
            'flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs transition',
            selected.length > 0
              ? 'border-foreground/30 bg-muted/70 text-foreground'
              : 'border-border/50 text-muted-foreground hover:text-foreground'
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="size-3.5 flex-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem disabled={selected.length === 0} onSelect={onClear}>
          {allLabel}
        </DropdownMenuItem>
        <div className="max-h-80 overflow-y-auto scrollbar-sleek">
          {[...groups].map(([provider, projects]) => (
            <React.Fragment key={provider}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{providerLabels[provider] ?? provider}</DropdownMenuLabel>
              {projects.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.key}
                  checked={option.selected}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => onToggle(option)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="ml-3 text-muted-foreground">{option.count}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </React.Fragment>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

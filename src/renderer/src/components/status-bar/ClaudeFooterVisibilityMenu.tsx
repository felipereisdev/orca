import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { ClaudeIcon } from './icons'
import type { useClaudeFooterAccounts } from './use-claude-footer-accounts'

export function ClaudeFooterVisibilityMenu({
  accounts,
  onToggleProvider
}: {
  accounts: ReturnType<typeof useClaudeFooterAccounts>
  onToggleProvider: () => void
}) {
  const t = useTranslate()
  const label = t('auto.components.status.bar.StatusBar.3885eb74d8', 'Claude Usage')
  const accountOptions = accounts.group?.targets.filter((target) => target.id !== null) ?? []
  const provider = (
    <DropdownMenuCheckboxItem checked={accounts.enabled} onCheckedChange={onToggleProvider}>
      <ClaudeIcon size={14} />
      {label}
    </DropdownMenuCheckboxItem>
  )
  if (accountOptions.length === 0) {
    return provider
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ClaudeIcon size={14} />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel>{accounts.group?.label}</DropdownMenuLabel>
        {provider}
        <DropdownMenuSeparator />
        {accountOptions.map((target) => (
          <DropdownMenuCheckboxItem
            key={target.id}
            checked={accounts.enabled && accounts.selectedIds.includes(target.id!)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => {
              const current = accounts.enabled ? accounts.selectedIds : []
              accounts.setSelected(
                checked ? [...current, target.id!] : current.filter((id) => id !== target.id)
              )
            }}
          >
            <span className="max-w-64 truncate">{target.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

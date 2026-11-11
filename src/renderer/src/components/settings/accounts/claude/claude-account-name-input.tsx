import { renameClaudeProviderAccount } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import type { AccountsPaneSectionModel } from '../accounts-pane-types'
import type { ProviderAccountRuntimeView } from '../../../provider-accounts/provider-account-visibility'
import type { ClaudeManagedAccountSummary } from '../../../../../../shared/managed-account-types'
import { useTranslate } from '@/i18n/use-translate'
import { Input } from '../../../ui/input'

export function ClaudeAccountNameInput({
  account,
  disabled,
  model,
  runtime
}: {
  account: ClaudeManagedAccountSummary
  disabled: boolean
  model: AccountsPaneSectionModel
  runtime: ProviderAccountRuntimeView
}) {
  const t = useTranslate()
  const commitName = (label: string | null) => {
    void model.runClaudeAccountAction(
      `rename:${account.id}`,
      () => renameClaudeProviderAccount(model.accountOwner, account.id, label),
      runtime
    )
  }
  return (
    <Input
      key={`${account.id}:${account.label ?? ''}`}
      defaultValue={account.label ?? ''}
      placeholder={account.email}
      aria-label={t('accounts.claude.accountName', 'Account name')}
      maxLength={80}
      disabled={disabled}
      className="h-7 w-32"
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      onBlur={(event) => {
        const label = event.currentTarget.value.trim() || null
        if (label !== (account.label ?? null)) {
          commitName(label)
        }
      }}
    />
  )
}

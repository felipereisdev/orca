import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { renameClaudeProviderAccount } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import type { AccountsPaneSectionModel } from '../accounts-pane-types'
import type { ProviderAccountRuntimeView } from '../../../provider-accounts/provider-account-visibility'
import type { ClaudeManagedAccountSummary } from '../../../../../../shared/managed-account-types'
import { useTranslate } from '@/i18n/use-translate'
import { Input } from '../../../ui/input'
import { Button } from '../../../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/tooltip'

export function ClaudeAccountNameEditor({
  account,
  disabled,
  model,
  runtime,
  onSelect
}: {
  account: ClaudeManagedAccountSummary
  disabled: boolean
  model: Pick<AccountsPaneSectionModel, 'accountOwner' | 'runClaudeAccountAction'>
  runtime: ProviderAccountRuntimeView
  onSelect: () => void
}) {
  const t = useTranslate()
  const editButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const finishEditing = () => {
    restoreFocus.current = true
    setEditing(false)
  }
  useEffect(() => {
    if (!editing && !disabled && restoreFocus.current) {
      restoreFocus.current = false
      editButton.current?.focus()
    }
  }, [editing, disabled])
  const commitName = () => {
    if (disabled) {
      return
    }
    const label = draft.trim() || null
    if (label === (account.label ?? null)) {
      finishEditing()
      return
    }
    void model.runClaudeAccountAction(
      `rename:${account.id}`,
      async () => {
        const next = await renameClaudeProviderAccount(model.accountOwner, account.id, label)
        finishEditing()
        return next
      },
      runtime
    )
  }
  if (editing) {
    return (
      <form
        className="flex min-w-0 items-center gap-1"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.stopPropagation()
            finishEditing()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          commitName()
        }}
      >
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          placeholder={account.email}
          aria-label={t('accounts.claude.accountName', 'Account name')}
          maxLength={80}
          disabled={disabled}
          className="h-6 w-40 min-w-0"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="submit"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={t('common.save', 'Save')}
            >
              <Check />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.save', 'Save')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              onClick={finishEditing}
              aria-label={t('common.cancel', 'Cancel')}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.cancel', 'Cancel')}</TooltipContent>
        </Tooltip>
      </form>
    )
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="inline"
        className="min-w-0 shrink justify-start"
        disabled={disabled || account.needsSignIn}
        onClick={onSelect}
      >
        <span className="truncate">{account.label || account.email}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('accounts.claude.renameAccount', 'Rename account')}
            disabled={disabled}
            onClick={() => {
              setDraft(account.label ?? '')
              setEditing(true)
            }}
          >
            <Pencil className="text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('accounts.claude.renameAccount', 'Rename account')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

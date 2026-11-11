import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { selectClaudeProviderAccount } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import type { ClaudeManagedAccountSummary } from '../../../../../../shared/managed-account-types'
import type { AccountsPaneSectionModel } from '../accounts-pane-types'
import { Badge } from '../../../ui/badge'
import { Button } from '../../../ui/button'
import { ButtonGroup } from '../../../ui/button-group'
import {
  getProviderAccountRuntime,
  providerAccountIsActiveInView
} from '../../../provider-accounts/provider-account-visibility'
import {
  formatAccountTimestamp,
  getClaudeAccountRuntimeLabel
} from '../scope/accounts-pane-runtime'
import {
  canOfferClaudeSignInLink,
  ClaudeSignInLinkMenu,
  withCopiedClaudeLink
} from './claude-sign-in-link-menu'
import { ClaudeAccountNameEditor } from './claude-account-name-editor'

export type ClaudeAccountCardModel = Pick<
  AccountsPaneSectionModel,
  | 'accountRuntime'
  | 'claudeAccounts'
  | 'accountVisibilityOptions'
  | 'claudeAction'
  | 'accountRuntimeUnavailable'
  | 'isRemoteAccountScope'
  | 'runClaudeAccountAction'
  | 'accountOwner'
  | 'setRemoveClaudeTarget'
>

export function ClaudeAccountCard({
  account,
  model
}: {
  account: ClaudeManagedAccountSummary
  model: ClaudeAccountCardModel
}) {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const {
    accountRuntime,
    claudeAccounts,
    accountVisibilityOptions,
    claudeAction,
    accountRuntimeUnavailable,
    isRemoteAccountScope,
    runClaudeAccountAction,
    accountOwner,
    setRemoveClaudeTarget
  } = model
  const selectAccount = () => {
    void runClaudeAccountAction(
      `select:${account.id}`,
      () =>
        selectClaudeProviderAccount(accountOwner, {
          accountId: account.id,
          ...getProviderAccountRuntime(account)
        }),
      getProviderAccountRuntime(account)
    )
  }
  const isActive = providerAccountIsActiveInView(
    account,
    claudeAccounts,
    accountRuntime,
    accountVisibilityOptions
  )
  const isReauthing = claudeAction === `reauth:${account.id}`
  const isBusy = claudeAction !== 'idle' || accountRuntimeUnavailable
  const accountRuntimeView = getProviderAccountRuntime(account)
  const reauthenticate = (copyLink: boolean): Promise<void> =>
    runClaudeAccountAction(
      `reauth:${account.id}`,
      () =>
        withCopiedClaudeLink(
          copyLink,
          window.api.claudeAccounts.reauthenticate({
            accountId: account.id,
            copyLink
          })
        ),
      accountRuntimeView
    )

  return (
    <div
      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
        isActive
          ? 'border-foreground/20 bg-accent/15'
          : 'border-border/70 hover:border-border hover:bg-accent/8'
      }`}
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-3 max-md:flex-col max-md:items-start">
        <div className="flex min-w-56 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <ClaudeAccountNameEditor
              account={account}
              disabled={isBusy}
              model={model}
              runtime={accountRuntimeView}
              onSelect={selectAccount}
            />
            <Badge variant="hostContext">
              {getClaudeAccountRuntimeLabel(account, accountRuntime.label)}
            </Badge>
            {isActive ? (
              <Badge variant="outline">
                {t('auto.components.settings.AccountsPane.e74831fb6b', 'Active')}
              </Badge>
            ) : null}
          </div>
          <button
            type="button"
            onClick={selectAccount}
            disabled={isBusy || account.needsSignIn}
            className="truncate text-left text-2xs text-muted-foreground disabled:cursor-default"
          >
            {account.needsSignIn
              ? t('accounts.claude.signInRequired', 'Sign in again to use this account')
              : account.organizationName
                ? `${account.organizationName} · ${formatAccountTimestamp(account.lastAuthenticatedAt, intlLocale)}`
                : formatAccountTimestamp(account.lastAuthenticatedAt, intlLocale)}
          </button>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1 max-md:w-full max-md:flex-wrap">
          <ButtonGroup>
            <Button
              variant="ghost"
              size="xs"
              onClick={(event) => {
                event.stopPropagation()
                void reauthenticate(false)
              }}
              disabled={isRemoteAccountScope || isBusy}
              className="h-6 px-2 text-muted-foreground hover:text-foreground"
            >
              {isReauthing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              {t('accounts.claude.signInAgain', 'Sign in again')}
            </Button>
            {canOfferClaudeSignInLink(accountRuntimeView.runtime) ? (
              <ClaudeSignInLinkMenu
                variant="ghost"
                disabled={isRemoteAccountScope || isBusy}
                onCopyLink={() => void reauthenticate(true)}
              />
            ) : null}
          </ButtonGroup>
          <Button
            variant="ghost"
            size="xs"
            onClick={(event) => {
              event.stopPropagation()
              setRemoveClaudeTarget({
                id: account.id,
                runtime: getProviderAccountRuntime(account)
              })
            }}
            disabled={isBusy}
            className="h-6 px-2 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3" />
            {t('auto.components.settings.AccountsPane.db209ee572', 'Remove')}
          </Button>
        </div>
      </div>
    </div>
  )
}

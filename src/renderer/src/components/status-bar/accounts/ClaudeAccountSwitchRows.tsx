import { AccountSwitchRowItem } from './AccountSwitchRowItem'
import { AccountSwitchSignedOutHeading } from './AccountSwitchList'
import { InlineUsageSignInAction, InlineUsageSkeleton } from '../usage/InlineProviderUsage'
import {
  AccountUsageGauge,
  AccountUsageNotChecked,
  isClaudeAccountNotChecked,
  useNotCheckedDescription
} from './AccountUsageGauge'
import type { InactiveAccountUsage } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type {
  ClaudeStatusSwitchGroup,
  CodexStatusRuntimeTarget
} from './status-bar-runtime-targets'

export function ClaudeAccountSwitchRows({
  group,
  previews,
  isSwitching,
  signingInId,
  canSignIn,
  onSignIn,
  onSelect
}: {
  group: ClaudeStatusSwitchGroup | undefined
  previews: InactiveAccountUsage[]
  isSwitching: boolean
  signingInId: string | null
  canSignIn: boolean
  onSignIn: (id: string) => void
  onSelect: (id: string | null, target: CodexStatusRuntimeTarget) => void
}) {
  const notCheckedDescription = useNotCheckedDescription()
  const rows = (group?.targets ?? []).map((target) => ({
    target,
    usage: previews.find((account) => account.accountId === target.id),
    signInId: target.needsSignIn && canSignIn ? target.id : null
  }))
  const renderRow = ({ target, usage, signInId }: (typeof rows)[number]) => (
    <AccountSwitchRowItem
      key={target.id ?? 'system'}
      label={target.label}
      detail={target.hint}
      active={target.active}
      aria-description={
        !signInId &&
        !target.active &&
        target.id &&
        canSignIn &&
        !usage?.isFetching &&
        isClaudeAccountNotChecked(usage?.rateLimits)
          ? notCheckedDescription
          : undefined
      }
      disabled={
        isSwitching ||
        signingInId !== null ||
        (signInId === null && (target.active || target.disabled))
      }
      onSelect={(event) => {
        event.preventDefault()
        if (signInId) {
          onSignIn(signInId)
        } else if (!target.active) {
          onSelect(target.id, target.runtimeTarget)
        }
      }}
      action={
        signInId ? (
          <InlineUsageSignInAction
            accountLabel={target.label}
            isSigningIn={signingInId === signInId}
            disabled={isSwitching || signingInId !== null}
            onSignIn={() => onSignIn(signInId)}
          />
        ) : undefined
      }
    >
      {signInId ? null : usage?.isFetching && !usage.rateLimits ? (
        <InlineUsageSkeleton />
      ) : usage?.rateLimits ? (
        <AccountUsageGauge limits={usage.rateLimits} isFetching={usage.isFetching} />
      ) : target.id && !target.active && canSignIn ? (
        // Why local only: a remote owner never reads inactive accounts here, so "not checked" would be wrong.
        <AccountUsageNotChecked />
      ) : null}
    </AccountSwitchRowItem>
  )
  return (
    <>
      {rows.filter((row) => !row.signInId).map(renderRow)}
      {rows.some((row) => row.signInId) ? (
        <>
          <AccountSwitchSignedOutHeading />
          {rows.filter((row) => row.signInId).map(renderRow)}
        </>
      ) : null}
    </>
  )
}

import { AccountSwitchRowItem } from './AccountSwitchRowItem'
import { AccountSwitchSignedOutHeading } from './AccountSwitchList'
import {
  InlineUsageBars,
  InlineUsageSignInAction,
  InlineUsageSkeleton
} from './InlineProviderUsage'
import type { InactiveAccountUsage } from '../../../../shared/rate-limit-types'
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
        <InlineUsageBars limits={usage.rateLimits} isFetching={usage.isFetching} />
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

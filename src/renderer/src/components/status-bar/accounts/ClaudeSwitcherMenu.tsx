import type React from 'react'
import type {
  ProviderRateLimits,
  RateLimitState
} from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { ClaudeRateLimitAccountsState } from '../../../../../shared/agent-accounts/managed-account-types'
import type { ChatAccountAction } from './ProviderAccountChatButton'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { useActiveAccountOwner } from '@/runtime/provider-accounts/ownership/use-active-account-owner'
import { ClaudeSwitcherForOwner } from './ClaudeSwitcherForOwner'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'

export type ClaudeSwitcherMenuProps = {
  claude: ProviderRateLimits | null
  compact: boolean
  iconOnly: boolean
  asSubmenu?: boolean
  triggerContent?: React.ReactNode
  chatAction?: ChatAccountAction
  usageState?: RateLimitState
  usageAccounts?: ClaudeRateLimitAccountsState | null
  usageOwner?: RuntimeClientTarget
}

export function ClaudeSwitcherMenu(props: ClaudeSwitcherMenuProps): React.JSX.Element | null {
  return props.chatAction ? (
    <ClaudeSwitcherForOwner
      {...props}
      key={getProviderAccountsOwnerKey(props.chatAction.target)}
      owner={{ target: props.chatAction.target, wslHostDistro: null }}
    />
  ) : (
    <FocusedClaudeSwitcher {...props} />
  )
}

function FocusedClaudeSwitcher(props: ClaudeSwitcherMenuProps): React.JSX.Element | null {
  const owner = useActiveAccountOwner(props.usageOwner ?? { kind: 'local' })
  return (
    <ClaudeSwitcherForOwner
      key={`${getProviderAccountsOwnerKey(owner.target)}:${owner.wslHostDistro ?? ''}`}
      {...props}
      owner={owner}
    />
  )
}

import { useMemo } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { AgentLaunchRoutingInput } from '@/lib/agent-session/launch/routing/agent-launch-routing'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import { useProviderAccountList } from '../status-bar/use-provider-account-list'
import { buildClaudeAccountPickerEntries } from './claude-account-picker-entries'

export function useClaudeAccountPicker(
  target: RuntimeClientTarget | null,
  projectRuntime: AgentLaunchRoutingInput['projectRuntime'],
  contextKey: string | undefined,
  open: boolean,
  enabled: boolean
) {
  const initialAccounts = useMemo(() => ({ accounts: [], activeAccountId: null }), [])
  const accountList = useProviderAccountList(
    'claude',
    target ?? { kind: 'local' },
    `${contextKey ?? ''}:${open}`,
    initialAccounts,
    open,
    enabled
  )
  const accountTarget =
    target?.kind === 'local' &&
    projectRuntime?.status === 'resolved' &&
    projectRuntime.runtime.kind === 'wsl'
      ? { runtime: 'wsl' as const, wslDistro: projectRuntime.runtime.distro }
      : { runtime: 'host' as const, wslDistro: null }
  return {
    accounts: accountList.accounts,
    expandAccounts: (entry: AgentPickerEntry) =>
      enabled && target
        ? buildClaudeAccountPickerEntries(entry, accountList.accounts, accountTarget)
        : [entry]
  }
}

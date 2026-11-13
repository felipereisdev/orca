import { SESSION_TABS_DATABASE_RUNTIME_CAPABILITY } from '../../../../../shared/session-tabs-runtime-capabilities'
import type { RuntimeMobileSessionTabsResult } from '../../../../../shared/runtime-session-contracts'
import { projectSessionTabAgentStatus } from './session-tab-agent-status-projection'
import {
  withoutSessionTabs,
  projectSessionTabBrowserPlacements
} from './session-tab-browser-placement-projection'
import { projectSessionTabFileHosts } from './session-tab-file-host-projection'

export function projectSessionTabsForClient(
  snapshot: RuntimeMobileSessionTabsResult,
  clientKind: 'mobile' | 'runtime' | undefined,
  clientCapabilities: Parameters<typeof projectSessionTabAgentStatus>[2]
): RuntimeMobileSessionTabsResult {
  if (clientKind && !clientCapabilities?.includes(SESSION_TABS_DATABASE_RUNTIME_CAPABILITY)) {
    const hidden = new Set(
      snapshot.tabs.filter((tab) => tab.type === 'database').map((tab) => tab.id)
    )
    if (hidden.size) {
      snapshot = withoutSessionTabs(snapshot, hidden)
    }
  }
  // Phones draw no agent message cards, so they never pay for sender identity.
  const { agentSenderAssociations: _desktopOnly, ...phone } = snapshot
  return projectSessionTabBrowserPlacements(
    projectSessionTabFileHosts(
      projectSessionTabAgentStatus(
        clientKind === 'mobile' ? phone : snapshot,
        clientKind,
        clientCapabilities
      ),
      clientKind
    ),
    clientCapabilities
  )
}

import type { NewGroupSplit } from './workspace-layout-command-types'
export type WindowContentTabOpenCommand = {
  tabId: string
  groupId?: string
  afterTabId?: string
  index?: number
  createdAt?: number
  split?: NewGroupSplit
} & ({ type: 'openSimulatorTab' } | { type: 'openDatabaseTab'; entityId: string })

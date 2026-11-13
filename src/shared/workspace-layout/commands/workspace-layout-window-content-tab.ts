import { databaseExplorerEntitySchema } from '../../database/database-explorer-reference'

import { applied, refuse, type Applied } from './workspace-layout-command-steps'
import type { CommandOf, LayoutContext } from '../workspace-layout-command-types'
import { drawnTabOpen, withSendersGroup } from './workspace-layout-content-commands'
import type { LayoutContentTab, WorkspaceLayoutModel } from '../workspace-layout-model'
import { placeContentTab } from './workspace-layout-tab-commands'

export function openWindowContentTab(
  model: WorkspaceLayoutModel,
  command: CommandOf<'openSimulatorTab'> | CommandOf<'openDatabaseTab'>,
  context: LayoutContext
): Applied {
  if (
    command.type === 'openDatabaseTab' &&
    !databaseExplorerEntitySchema.safeParse(command.entityId).success
  ) {
    return refuse('invalid_params')
  }
  const kind = command.type === 'openDatabaseTab' ? 'database' : 'simulator'
  const entityId = command.type === 'openDatabaseTab' ? command.entityId : command.tabId
  const key = command.workspace
  // Only a layout-owner window sends this command, so a taken id is always refused.
  const drawn = drawnTabOpen(
    model,
    key,
    command.tabId,
    (tab) => tab.kind === kind && tab.entityId === entityId,
    true
  )
  if (drawn) {
    return drawn
  }
  const workspace = model.workspaces[key]
  if (
    command.groupId &&
    workspace?.groups.length &&
    !workspace.groups.some((entry) => entry.id === command.groupId)
  ) {
    return refuse('group_not_found')
  }
  const tab: LayoutContentTab = {
    id: command.tabId,
    entityId,
    kind,
    createdAt: command.createdAt ?? context.now(),
    customTitle: null,
    color: null
  }
  const target = withSendersGroup(model, key, command.groupId)
  return applied(placeContentTab(target, key, tab, command, context).model, { tabId: tab.id })
}

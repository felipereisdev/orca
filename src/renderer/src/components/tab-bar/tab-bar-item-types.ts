import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import type { BrowserWorkspace } from '../../../../shared/browser-workspace-types'
import type { OpenFile } from '../../store/slices/editor/types/open-file'

type ContentStripItem<Kind extends 'simulator' | 'database'> = {
  type: Kind
  id: string
  unifiedTabId: string
  isPinned: boolean
  data: Tab
}

export type TabBarItem =
  | {
      type: 'terminal'
      id: string
      unifiedTabId: string
      isPinned: boolean
      data: TerminalTab & { unifiedTabId?: string }
    }
  | {
      type: 'editor'
      id: string
      unifiedTabId: string
      isPinned: boolean
      data: OpenFile & { tabId?: string }
    }
  | {
      type: 'browser'
      id: string
      unifiedTabId: string
      isPinned: boolean
      data: BrowserWorkspace & { tabId?: string }
    }
  | ContentStripItem<'simulator'>
  | ContentStripItem<'database'>
  | {
      type: 'agent-session'
      id: string
      unifiedTabId: string
      isPinned: boolean
      data: Tab & { contentType: 'agent-session' }
    }

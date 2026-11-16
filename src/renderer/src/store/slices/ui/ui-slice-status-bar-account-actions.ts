import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'

/** Which named Claude accounts the footer shows per account scope; picking one also shows Claude usage. */
export function createStatusBarClaudeAccountActions(
  set: UISliceSet,
  get: UISliceGet
): Partial<UISlice> {
  return {
    statusBarClaudeAccountIdsByScope: {},
    setStatusBarClaudeAccounts: (scope, ids) => {
      const state = get()
      const statusBarClaudeAccountIdsByScope = {
        ...state.statusBarClaudeAccountIdsByScope,
        [scope]: [...new Set(ids)]
      }
      const statusBarItems =
        ids.length && !state.statusBarItems.includes('claude')
          ? [...state.statusBarItems, 'claude' as const]
          : state.statusBarItems
      window.api.ui.set({ statusBarClaudeAccountIdsByScope, statusBarItems }).catch(console.error)
      set({ statusBarClaudeAccountIdsByScope, statusBarItems })
    }
  }
}

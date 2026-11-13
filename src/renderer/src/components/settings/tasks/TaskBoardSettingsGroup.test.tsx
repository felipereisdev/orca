// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { useAppStore } from '@/store/index'
import { TaskBoardSettingsGroup } from './TaskBoardSettingsGroup'

let container: HTMLDivElement
let root: Root
const updateSettings = vi.fn(async (_updates: Partial<GlobalSettings>) => {})

function savedJiraRules(): unknown {
  return updateSettings.mock.calls.at(-1)?.[0].taskBoard?.providers.jira.rules
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  updateSettings.mockClear()
  useAppStore.setState({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the group only reads taskBoard.
    settings: {} as never,
    workspaceStatuses: [
      { id: 'todo', label: 'Todo' },
      { id: 'in-review', label: 'In review' }
    ],
    updateSettings
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<TaskBoardSettingsGroup />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TaskBoardSettingsGroup', () => {
  it('saves a typed rule once the match is committed on blur', () => {
    const addRule = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add rule'
    )
    act(() => addRule?.click())
    // An empty match is not a valid rule, so adding the row alone does not persist anything useful.
    expect(savedJiraRules()).toEqual([])

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Status name"]')
    if (!input) {
      throw new Error('rule input missing')
    }
    input.value = 'In QA'
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    expect(savedJiraRules()).toEqual([{ match: 'In QA', statusId: 'todo' }])
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import userEvent from '@testing-library/user-event'
import type * as LaunchSetup from './AgentLaunchSetupButton'
import type { AgentLaunchSetupButton } from './AgentLaunchSetupButton'
import { AgentLaunchPickerMenu } from './AgentLaunchPickerMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'

vi.mock('@/hooks/useShortcutLabel', () => ({ useOptionalShortcutLabel: () => null }))
vi.mock('./AgentLaunchSetupButton', async (importOriginal) => ({
  ...(await importOriginal<typeof LaunchSetup>()),
  AgentLaunchSetupButton: vi.fn((props: ComponentProps<typeof AgentLaunchSetupButton>) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger asChild hideChevron>
        {props.renderAnchor?.(<button>Setup</button>)}
      </DropdownMenuSubTrigger>
    </DropdownMenuSub>
  ))
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function SearchablePickerSelection({ entries }: { entries: AgentPickerEntry[] }) {
  const [selection, setSelection] = useState('')
  return (
    <>
      <output aria-label="Selection">{selection}</output>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <AgentLaunchPickerMenu
            entries={entries}
            runLaunch={(row, draft) => setSelection(`${row.agent}:${draft?.choices.model ?? ''}`)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

it('includes blank terminal in keyboard results and filters it for agent and model searches', async () => {
  const entry: AgentPickerEntry = {
    agent: 'codex',
    label: 'Codex',
    rows: [{ agent: 'codex', kind: 'cli' }],
    surfaces: ['terminal'],
    defaultSurface: 'terminal',
    terminal: {},
    structured: {},
    catalog: {
      origin: 'probe',
      fetchedAt: 1,
      models: [{ id: 'astra', label: 'Astra', isDefault: true, efforts: [] }]
    }
  }
  const antigravity: AgentPickerEntry = {
    ...entry,
    agent: 'antigravity',
    label: 'Antigravity',
    rows: [{ agent: 'antigravity', kind: 'cli' }],
    catalog: { origin: 'probe', fetchedAt: 1, models: [] }
  }
  function Picker({ showLeadingItem = false }: { showLeadingItem?: boolean }) {
    const [selection, setSelection] = useState('')
    return (
      <>
        <output aria-label="Selection">{selection}</output>
        <DropdownMenu defaultOpen modal={false}>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <AgentLaunchPickerMenu
              entries={[entry, antigravity]}
              leadingItems={
                showLeadingItem ? <DropdownMenuItem>Custom command</DropdownMenuItem> : undefined
              }
              onSelectBlankTerminal={() => setSelection('blank')}
              runLaunch={(row, draft) => {
                setSelection(`${row.agent}:${draft?.choices.model ?? ''}`)
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }
  const view = render(<Picker />)
  const user = userEvent.setup()
  const input = screen.getByRole('textbox')
  await user.click(input)
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Blank Terminal' }))
  await user.click(input)
  await user.type(input, 'shell{Enter}')
  expect(screen.getByLabelText('Selection').textContent).toBe('blank')

  view.rerender(<Picker showLeadingItem />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Custom command' }))
  await user.type(screen.getByRole('textbox'), 'codex')
  expect(screen.queryByRole('menuitem', { name: 'Blank Terminal' })).toBeNull()
  await user.keyboard('{Enter}')
  expect(screen.getByLabelText('Selection').textContent).toBe('codex:')

  await user.click(screen.getByRole('button', { name: 'Open' }))
  await user.type(screen.getByRole('textbox'), 'anti')
  expect(screen.queryByRole('menuitem', { name: 'Blank Terminal' })).toBeNull()
  await user.keyboard('{Enter}')
  expect(screen.getByLabelText('Selection').textContent).toBe('antigravity:')

  await user.click(screen.getByRole('button', { name: 'Open' }))
  await user.type(screen.getByRole('textbox'), 'astra{Enter}')
  expect(screen.getByLabelText('Selection').textContent).toBe('codex:astra')
})

it('selects an agent named by the query before other agents’ model setups', () => {
  const codex: AgentPickerEntry = {
    agent: 'codex',
    label: 'Codex',
    rows: [{ agent: 'codex', kind: 'cli' }],
    surfaces: ['terminal'],
    defaultSurface: 'terminal',
    terminal: {},
    structured: {},
    catalog: { origin: 'probe', fetchedAt: 1, models: [] }
  }
  const opencode: AgentPickerEntry = {
    ...codex,
    agent: 'opencode',
    label: 'OpenCode',
    rows: [{ agent: 'opencode', kind: 'cli' }],
    catalog: {
      origin: 'probe',
      fetchedAt: 1,
      models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex', isDefault: false, efforts: [] }]
    }
  }
  render(<SearchablePickerSelection entries={[opencode, codex]} />)
  fireEvent.focus(screen.getByRole('textbox'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'codex' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  expect(screen.getByLabelText('Selection').textContent).toBe('codex:')
})

it('matches Antigravity and its model setups via the AGY acronym', async () => {
  const codex: AgentPickerEntry = {
    agent: 'codex',
    label: 'Codex',
    rows: [{ agent: 'codex', kind: 'cli' }],
    surfaces: ['terminal'],
    defaultSurface: 'terminal',
    terminal: {},
    structured: {},
    catalog: { origin: 'probe', fetchedAt: 1, models: [] }
  }
  const antigravity: AgentPickerEntry = {
    ...codex,
    agent: 'antigravity',
    label: 'Antigravity',
    rows: [{ agent: 'antigravity', kind: 'cli' }],
    catalog: {
      origin: 'probe',
      fetchedAt: 1,
      models: [{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', isDefault: false, efforts: [] }]
    }
  }
  const user = userEvent.setup()
  render(<SearchablePickerSelection entries={[codex, antigravity]} />)
  await user.type(screen.getByRole('textbox'), 'AGY{Enter}')
  expect(screen.getByLabelText('Selection').textContent).toBe('antigravity:')

  await user.click(screen.getByRole('button', { name: 'Open' }))
  await user.type(screen.getByRole('textbox'), 'AGY Gemini{Enter}')
  expect(screen.getByLabelText('Selection').textContent).toBe('antigravity:gemini-2.5-pro')
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraBoardMoveDialog } from './task-page-jira-board-move-dialog'

afterEach(cleanup)

describe('JiraBoardMoveDialog', () => {
  it('submits the chosen resolution for a status change the host says needs fields', async () => {
    const choice = {
      id: '31',
      name: 'Resolve',
      fields: {
        resolution: {
          required: true,
          options: [
            { id: '1', name: 'Fixed' },
            { id: '2', name: 'Won’t fix' }
          ]
        },
        commentRequired: false
      }
    }
    const onSubmit = vi.fn(async () => {})
    render(
      <JiraBoardMoveDialog
        prompt={{
          issueKey: 'APP-1',
          issueUrl: 'https://jira.example.com/browse/APP-1',
          destination: 'Done',
          choices: [choice],
          selected: choice,
          error: null,
          loading: false
        }}
        pending={false}
        onClose={vi.fn()}
        onChoose={vi.fn()}
        onSubmit={onSubmit}
        onRetry={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Fixed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ choiceId: '31', fields: { resolutionId: '1' } })
    )
  })
})

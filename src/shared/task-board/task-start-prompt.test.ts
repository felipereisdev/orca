import { describe, expect, it } from 'vitest'
import { buildTaskStartPrompt, taskStartWorkerCommand } from './task-start-prompt'
import type { TaskStartContext } from './task-start-context-types'

const context: TaskStartContext = {
  displayId: 'ABC-1',
  title: 'Titulo',
  url: 'https://x/1',
  provider: 'jira',
  description: 'Use `$reviewer` e $qa aqui',
  comments: [],
  images: []
}

describe('buildTaskStartPrompt', () => {
  it('substitutes role tokens only inside the flow text', () => {
    const prompt = buildTaskStartPrompt({
      context,
      roles: {
        planReviewer: { agent: 'codex' },
        implementer: { agent: 'codex' },
        reviewer: { agent: 'codex' },
        qa: { agent: 'codex' }
      },
      labels: { planReviewer: 'L1', implementer: 'L2', reviewer: 'L3', qa: 'L4' }
    })
    expect(prompt).toContain('Use `$reviewer` e $qa aqui')
    const flow = prompt.slice(prompt.indexOf('## Fluxo'))
    expect(flow).not.toMatch(/\$(revisor|implementer|reviewer|qa)/)
    expect(flow).toContain('L1')
  })
})

describe('taskStartWorkerCommand', () => {
  it('omits account, model and effort when unset', () => {
    const command = taskStartWorkerCommand({ agent: 'codex' })
    expect(command).not.toMatch(/--model|--effort|--account/)
  })

  it('orders account, model and effort', () => {
    const command = taskStartWorkerCommand({
      agent: 'claude',
      accountId: 'acc',
      model: 'opus',
      effort: 'high'
    })
    expect(command).toContain(
      '--agent claude --account acc --model opus --effort high --worktree current'
    )
  })

  it('shell-quotes values with unsafe characters', () => {
    const command = taskStartWorkerCommand({ agent: 'claude', model: "o p'us" })
    expect(command).toContain("--model 'o p'\\''us'")
  })
})
